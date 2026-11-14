/**
 * Patches EBML `Segment -> Info` (0x1549A966) in a streaming MediaRecorder WebM
 * Blob to include a finite float64 `Duration` element (0x4489) when missing.
 *
 * Browsers emit streaming WebM segments with an unknown-length `Segment` VINT
 * (`0x01FFFFFFFFFFFFFF`) and omit `Duration` in `Info`, causing `<video>` players
 * to report `duration === Infinity`. Because `Segment` uses unknown size, expanding
 * `Info` inside the first 4 KB header slice and concatenating `blob.slice(infoEnd)`
 * produces a spec-valid, seekable WebM in O(1) memory without copying media clusters.
 */

interface EbmlVint {
  readonly length: number;
  readonly value: number;
  readonly isUnknownSize: boolean;
}

function readVint(bytes: Uint8Array, offset: number): EbmlVint | null {
  const first = bytes[offset];
  if (first === undefined || first === 0) {
    return null;
  }

  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    length += 1;
    mask >>= 1;
  }

  if (length > 8 || offset + length > bytes.length) {
    return null;
  }

  let value = first & (mask - 1);
  let allOnes = value === mask - 1;

  for (let i = 1; i < length; i += 1) {
    const b = bytes[offset + i];
    if (b === undefined) {
      return null;
    }
    value = value * 256 + b;
    if (b !== 0xff) {
      allOnes = false;
    }
  }

  return {
    length,
    value,
    isUnknownSize: allOnes,
  };
}

function readElementId(
  bytes: Uint8Array,
  offset: number,
): { readonly id: number; readonly length: number } | null {
  const first = bytes[offset];
  if (first === undefined || first === 0) {
    return null;
  }

  let length = 1;
  let mask = 0x80;
  while (length <= 4 && (first & mask) === 0) {
    length += 1;
    mask >>= 1;
  }

  if (length > 4 || offset + length > bytes.length) {
    return null;
  }

  let id = 0;
  for (let i = 0; i < length; i += 1) {
    const b = bytes[offset + i];
    if (b === undefined) {
      return null;
    }
    id = id * 256 + b;
  }

  return { id, length };
}

function readUnsignedInt(
  bytes: Uint8Array,
  offset: number,
  size: number,
): number | null {
  if (size < 1 || size > 6 || offset + size > bytes.length) {
    return null;
  }
  let result = 0;
  for (let i = 0; i < size; i += 1) {
    const b = bytes[offset + i];
    if (b === undefined) {
      return null;
    }
    result = result * 256 + b;
  }
  return result;
}

export async function readBlobBytes(
  blob: Blob,
): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof blob.arrayBuffer === 'function') {
    const ab = await blob.arrayBuffer();
    return new Uint8Array(ab);
  }
  return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result));
      } else {
        reject(new Error('Expected ArrayBuffer from FileReader'));
      }
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('FileReader failed'));
    };
    reader.readAsArrayBuffer(blob);
  });
}

export async function patchWebmDurationIfStreaming(
  blob: Blob,
  durationMs: number,
  mimeType: string,
): Promise<Blob> {
  if (
    !mimeType.toLowerCase().includes('webm') ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    blob.size < 32
  ) {
    return blob;
  }

  try {
    const headerSliceSize = Math.min(blob.size, 8192);
    const bytes = await readBlobBytes(blob.slice(0, headerSliceSize));

    // 1. Verify EBML Header ID (0x1A45DFA3) at offset 0
    const ebmlHeader = readElementId(bytes, 0);
    if (ebmlHeader?.id !== 0x1a45dfa3) {
      return blob;
    }
    const ebmlSize = readVint(bytes, ebmlHeader.length);
    if (!ebmlSize || ebmlSize.isUnknownSize) {
      return blob;
    }

    const segmentOffset = ebmlHeader.length + ebmlSize.length + ebmlSize.value;
    const segmentId = readElementId(bytes, segmentOffset);
    if (segmentId?.id !== 0x18538067) {
      return blob;
    }

    const segmentSize = readVint(bytes, segmentOffset + segmentId.length);
    // Only patch streaming unknown-size Segments so finite Segment offsets stay intact
    if (!segmentSize?.isUnknownSize) {
      return blob;
    }

    // 2. Walk top-level Segment children inside header slice to find Info (0x1549A966)
    let cursor = segmentOffset + segmentId.length + segmentSize.length;
    while (cursor < bytes.length) {
      const elemId = readElementId(bytes, cursor);
      if (!elemId) {
        return blob;
      }
      const elemSizeOffset = cursor + elemId.length;
      const elemSize = readVint(bytes, elemSizeOffset);
      if (!elemSize || elemSize.isUnknownSize) {
        return blob;
      }

      const payloadStart = elemSizeOffset + elemSize.length;
      const payloadEnd = payloadStart + elemSize.value;
      if (payloadEnd > bytes.length) {
        return blob;
      }

      if (elemId.id === 0x1549a966) {
        // Inspect Info children: check if Duration (0x4489) already exists & read TimecodeScale (0x2AD7B1)
        let timecodeScaleNs = 1_000_000; // WebM default: 1ms per tick
        let infoCursor = payloadStart;
        while (infoCursor < payloadEnd) {
          const childId = readElementId(bytes, infoCursor);
          if (!childId) {
            return blob;
          }
          const childSize = readVint(bytes, infoCursor + childId.length);
          if (!childSize || childSize.isUnknownSize) {
            return blob;
          }
          const childPayloadStart =
            infoCursor + childId.length + childSize.length;
          const childPayloadEnd = childPayloadStart + childSize.value;
          if (childPayloadEnd > payloadEnd) {
            return blob;
          }

          if (childId.id === 0x4489) {
            // Duration element already present
            return blob;
          }
          if (childId.id === 0x2ad7b1) {
            const parsedScale = readUnsignedInt(
              bytes,
              childPayloadStart,
              childSize.value,
            );
            if (parsedScale !== null && parsedScale > 0) {
              timecodeScaleNs = parsedScale;
            }
          }
          infoCursor = childPayloadEnd;
        }

        // Build Duration element: ID 0x4489, VINT size 0x88 (8 bytes), float64 big-endian
        const scaledDuration = (durationMs * 1_000_000) / timecodeScaleNs;
        const durationElement = new Uint8Array(11);
        durationElement[0] = 0x44;
        durationElement[1] = 0x89;
        durationElement[2] = 0x88;
        new DataView(durationElement.buffer).setFloat64(
          3,
          scaledDuration,
          false,
        );

        const newInfoPayloadSize = elemSize.value + durationElement.byteLength;
        const newInfoSizeVint = new Uint8Array(4);
        new DataView(newInfoSizeVint.buffer).setUint32(
          0,
          (0x10000000 | newInfoPayloadSize) >>> 0,
          false,
        );

        const prefix = bytes.subarray(0, elemSizeOffset);
        const existingInfoPayload = bytes.subarray(payloadStart, payloadEnd);

        return new Blob(
          [
            prefix,
            newInfoSizeVint,
            existingInfoPayload,
            durationElement,
            blob.slice(payloadEnd),
          ],
          { type: mimeType },
        );
      }

      // Stop searching once Cluster (0x1F43B675) is reached
      if (elemId.id === 0x1f43b675) {
        return blob;
      }

      cursor = payloadEnd;
    }

    return blob;
  } catch {
    return blob;
  }
}

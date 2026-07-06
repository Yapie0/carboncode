import { writeSync } from "node:fs";

export type SyncBufferWriter = (
  fd: number,
  buffer: Buffer,
  offset: number,
  length: number,
) => number;

const retrySleepBuffer = new SharedArrayBuffer(4);
const retrySleepArray = new Int32Array(retrySleepBuffer);

function sleepSync(ms: number): void {
  Atomics.wait(retrySleepArray, 0, 0, ms);
}

function isTemporarilyUnavailable(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err.code === "EAGAIN" || err.code === "EWOULDBLOCK")
  );
}

export function writeAllSync(
  fd: number,
  buffer: Buffer,
  writer: SyncBufferWriter = (targetFd, targetBuffer, offset, length) =>
    writeSync(targetFd, targetBuffer, offset, length),
  sleep: (ms: number) => void = sleepSync,
): void {
  let offset = 0;
  while (offset < buffer.byteLength) {
    let written = 0;
    try {
      written = writer(fd, buffer, offset, buffer.byteLength - offset);
    } catch (err) {
      if (isTemporarilyUnavailable(err)) {
        sleep(5);
        continue;
      }
      throw err;
    }
    if (written <= 0) {
      throw new Error(
        `writeSync wrote ${written} bytes while ${buffer.byteLength - offset} bytes remained`,
      );
    }
    offset += written;
  }
}

export function writeJsonLineSync(fd: number, payload: unknown, writer?: SyncBufferWriter): void {
  writeAllSync(fd, Buffer.from(`${JSON.stringify(payload)}\n`, "utf8"), writer);
}

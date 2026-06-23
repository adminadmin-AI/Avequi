/**
 * CRC16-CCITT-FALSE
 * Polynomial: 0x1021  |  Initial value: 0xFFFF  |  No input/output reflection
 * Used for Pix QR Code (EMV BRCode) checksum — Tag 63
 */
export function crc16(payload: string): string {
  const POLY = 0x1021;
  let crc = 0xffff;

  for (let i = 0; i < payload.length; i++) {
    const byte = payload.charCodeAt(i);
    crc ^= byte << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ POLY) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, '0');
}

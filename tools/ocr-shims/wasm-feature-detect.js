// Проверка поддержки SIMD в браузере (маленький тестовый модуль WebAssembly).
const SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
export const simd = async () => { try { return WebAssembly.validate(SIMD); } catch { return false; } };
// Расширенный SIMD не используем — достаточно обычного
export const relaxedSimd = async () => false;

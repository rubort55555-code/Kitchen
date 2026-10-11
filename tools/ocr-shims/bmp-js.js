// BMP не нужен: на вход идёт PNG/JPEG из canvas.
module.exports = { decode() { throw new Error("BMP не поддерживается"); }, encode() { throw new Error("BMP не поддерживается"); } };

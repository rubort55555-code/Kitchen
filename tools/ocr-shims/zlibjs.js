// Файлы языков храним без сжатия (gzip: false), поэтому распаковка не нужна.
module.exports = { gunzipSync() { throw new Error("gzip не используется"); } };

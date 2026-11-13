// The bytes a model's files take, as models.json lists them: what its
// download says it costs and what its progress counts against, for the
// text models and the readings' dictionary alike.

export const filesBytes = (
  files: ReadonlyArray<Readonly<{ bytes: number }>>,
): number => files.reduce((sum, file) => sum + file.bytes, 0)

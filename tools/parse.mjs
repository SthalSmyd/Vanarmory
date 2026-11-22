// 説明文の分解は、画面と共用の web/parse.js にある
import { createRequire } from 'node:module';

const parse = createRequire(import.meta.url)('../web/parse.js');

export const normalize = parse.normalize;
export const parseDescription = parse.parseDescription;

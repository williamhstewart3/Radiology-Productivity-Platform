declare module 'papaparse' {
  export interface ParseError {
    type: string;
    code: string;
    message: string;
    row?: number;
  }

  export interface ParseResult<T> {
    data: T[];
    errors: ParseError[];
    meta: unknown;
  }

  export interface ParseConfig {
    skipEmptyLines?: boolean;
    header?: boolean;
  }

  export function parse<T = unknown>(input: string, config?: ParseConfig): ParseResult<T>;

  const Papa: {
    parse: typeof parse;
  };
  export default Papa;
}

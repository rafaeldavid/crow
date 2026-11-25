// The seller's bundle, uploaded beside the Worker as a text module (entry.ts).
declare module '*.txt' {
  const text: string;
  export default text;
}

/** An expected failure of the tool itself (bad config, page didn't load, layout never settled). Exits 2. */
export class UilintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UilintError';
  }
}

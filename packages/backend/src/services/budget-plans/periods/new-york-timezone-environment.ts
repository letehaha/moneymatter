import { TestEnvironment as NodeEnvironment } from 'jest-environment-node';

/**
 * `test:unit` pins TZ=UTC for the whole run, and setting `process.env.TZ` from
 * inside a test cannot work: the sandbox holds a copy of the env.
 */
export default class NewYorkTimezoneEnvironment extends NodeEnvironment {
  private previousTimezone = process.env.TZ;

  async setup() {
    process.env.TZ = 'America/New_York';
    await super.setup();
  }

  async teardown() {
    await super.teardown();
    // Never assign undefined here: process.env stores the string "undefined", which resolves to UTC.
    if (this.previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = this.previousTimezone;
  }
}

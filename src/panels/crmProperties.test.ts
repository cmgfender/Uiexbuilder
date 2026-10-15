import { describe, expect, it } from 'vitest';
import { likelyPropertyTypo, propertyNameWarning } from './crmProperties';

describe('likelyPropertyTypo', () => {
  it('finds unfinished names, typos and wrong capitalisation', () => {
    expect(likelyPropertyTypo('life', ['contacts'])?.name).toBe('lifecyclestage');
    expect(likelyPropertyTypo('firstnmae', ['contacts'])?.name).toBe('firstname');
    expect(likelyPropertyTypo('emial', ['0-1'])?.name).toBe('email');
    expect(likelyPropertyTypo('FirstName', ['contacts'])?.name).toBe('firstname');
    expect(likelyPropertyTypo('dealnme', ['deals'])?.name).toBe('dealname');
  });

  it('accepts known and custom properties, and custom objects', () => {
    expect(likelyPropertyTypo('firstname', ['contacts'])).toBeNull();
    expect(likelyPropertyTypo('my_custom_score', ['contacts'])).toBeNull();
    expect(likelyPropertyTypo('custom-prop', ['contacts'])).toBeNull();
    expect(likelyPropertyTypo('life', ['2-1234567'])).toBeNull();
    expect(likelyPropertyTypo('life', [])).toBeNull();
    // A property of any of the card's object types is fine.
    expect(likelyPropertyTypo('dealname', ['contacts', 'deals'])).toBeNull();
  });

  it('explains the warning and offers the fix', () => {
    expect(propertyNameWarning('life', ['contacts'])).toEqual({
      message: '“life” isn’t a standard contacts property — did you mean “lifecyclestage” (Lifecycle stage)? Ignore this for a custom property.',
      fix: 'lifecyclestage',
    });
    expect(propertyNameWarning('email', ['contacts'])).toBeNull();
  });
});

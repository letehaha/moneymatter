/**
 * The JavaScript that runs inside the sandbox, as source strings the worker evaluates in a fresh
 * QuickJS context. Both are plain ES2020 without template literals, because they are strings here
 * and not compiled with the rest of the backend.
 *
 * - `GUEST_HELPERS_SOURCE` defines the helper library as frozen, read-only globals and removes the
 *   few globals QuickJS ships that the sandbox must not offer (shared memory and `Atomics`).
 * - `GUEST_DRIVER_SOURCE` compiles the model's code as a function body, runs it on the deep-frozen
 *   input and returns the result as one string: `O` + the JSON output, or `E` + a JSON error.
 *
 * Nothing here reads the clock, so a helper's result depends on its arguments alone.
 */

export const GUEST_HELPERS_SOURCE = `
(function (g) {
  'use strict';

  var fail = function (message) {
    throw new TypeError(message);
  };

  var describe = function (value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'an array';
    if (typeof value === 'string') return 'the string "' + value.slice(0, 20) + '"';
    return typeof value === 'number' ? String(value) : 'a ' + typeof value;
  };

  var selectorOf = function (selector) {
    if (selector === undefined || selector === null) return function (item) { return item; };
    if (typeof selector === 'function') return selector;
    if (typeof selector === 'string') {
      return function (item) { return item === null || item === undefined ? undefined : item[selector]; };
    }
    return fail('A selector is a property name or a function');
  };

  var arrayOf = function (items, name) {
    if (!Array.isArray(items)) fail(name + ' needs an array, got ' + describe(items));
    return items;
  };

  var numbersOf = function (items, selector, name) {
    var pick = selectorOf(selector);
    return arrayOf(items, name).map(function (item, index) {
      var value = pick(item, index);
      if (typeof value !== 'number' || !isFinite(value)) {
        fail(name + ' needs finite numbers, but item ' + index + ' is ' + describe(value));
      }
      return value;
    });
  };

  var checkDecimals = function (decimals) {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8) {
      fail('decimals must be an integer from 0 to 8, got ' + describe(decimals));
    }
    return decimals;
  };

  var toMinor = function (value, decimals) {
    checkDecimals(decimals);
    if (typeof value !== 'number' || !isFinite(value)) fail('toMinor needs a finite number, got ' + describe(value));
    var magnitude = Math.abs(value);
    var text = String(magnitude);
    var scaled = /e/i.test(text) ? magnitude * Math.pow(10, decimals) : Number(text + 'e' + decimals);
    var rounded = Math.round(scaled);
    return value < 0 ? -rounded : rounded;
  };

  var fromMinor = function (minor, decimals) {
    checkDecimals(decimals);
    return Number(minor + 'e-' + decimals);
  };

  var sum = function (items, selector) {
    return numbersOf(items, selector, 'sum').reduce(function (total, value) { return total + value; }, 0);
  };

  var mean = function (items, selector) {
    var values = numbersOf(items, selector, 'mean');
    return values.length === 0 ? null : sum(values) / values.length;
  };

  var sortedNumbers = function (items, selector, name) {
    return numbersOf(items, selector, name).slice().sort(function (a, b) { return a - b; });
  };

  var percentile = function (items, p, selector) {
    if (typeof p !== 'number' || !isFinite(p) || p < 0 || p > 100) fail('percentile needs p from 0 to 100, got ' + describe(p));
    var values = sortedNumbers(items, selector, 'percentile');
    if (values.length === 0) return null;
    var position = (p / 100) * (values.length - 1);
    var lower = Math.floor(position);
    var upper = Math.ceil(position);
    return values[lower] + (values[upper] - values[lower]) * (position - lower);
  };

  var median = function (items, selector) {
    return percentile(items, 50, selector);
  };

  var groupBy = function (items, selector) {
    var pick = selectorOf(selector);
    var groups = Object.create(null);
    arrayOf(items, 'groupBy').forEach(function (item, index) {
      var key = String(pick(item, index));
      if (!(key in groups)) groups[key] = [];
      groups[key].push(item);
    });
    return groups;
  };

  var isMissing = function (value) {
    return value === null || value === undefined || (typeof value === 'number' && isNaN(value));
  };

  var sortBy = function (items, selector, direction) {
    if (direction !== undefined && direction !== 'asc' && direction !== 'desc') fail('direction is "asc" or "desc"');
    var pick = selectorOf(selector);
    var sign = direction === 'desc' ? -1 : 1;
    var keyed = arrayOf(items, 'sortBy').map(function (item, index) {
      return { item: item, key: pick(item, index), index: index };
    });
    keyed.sort(function (a, b) {
      var aMissing = isMissing(a.key);
      var bMissing = isMissing(b.key);
      if (aMissing || bMissing) return aMissing === bMissing ? a.index - b.index : aMissing ? 1 : -1;
      if (a.key < b.key) return -sign;
      if (a.key > b.key) return sign;
      return a.index - b.index;
    });
    return keyed.map(function (entry) { return entry.item; });
  };

  var movingAverage = function (items, windowSize, selector) {
    if (!Number.isInteger(windowSize) || windowSize < 1) fail('movingAverage needs a whole window size of at least 1, got ' + describe(windowSize));
    var values = numbersOf(items, selector, 'movingAverage');
    return values.map(function (_, index) {
      if (index < windowSize - 1) return null;
      return sum(values.slice(index - windowSize + 1, index + 1)) / windowSize;
    });
  };

  var minorSum = function (items, decimals, selector) {
    checkDecimals(decimals);
    var total = numbersOf(items, selector, 'minor.sum').reduce(function (acc, value) {
      return acc + toMinor(value, decimals);
    }, 0);
    return fromMinor(total, decimals);
  };

  var byMonth = function (items, dateSelector, valueSelector, decimals) {
    var places = decimals === undefined ? 2 : checkDecimals(decimals);
    var pickDate = selectorOf(dateSelector);
    var pickValue = valueSelector === undefined ? null : selectorOf(valueSelector);
    var buckets = Object.create(null);
    arrayOf(items, 'byMonth').forEach(function (item, index) {
      var date = pickDate(item, index);
      if (typeof date !== 'string' || !/^\\d{4}-\\d{2}(-|T|$)/.test(date)) {
        fail('byMonth needs ISO dates like 2026-03-15, but item ' + index + ' is ' + describe(date));
      }
      var month = date.slice(0, 7);
      if (!(month in buckets)) buckets[month] = { month: month, count: 0, sum: null, items: [] };
      var bucket = buckets[month];
      bucket.count += 1;
      bucket.items.push(item);
      if (pickValue) {
        var value = pickValue(item, index);
        if (typeof value !== 'number' || !isFinite(value)) fail('byMonth needs finite numbers, but item ' + index + ' is ' + describe(value));
        bucket.minor = (bucket.minor || 0) + toMinor(value, places);
      }
    });
    return Object.keys(buckets).sort().map(function (month) {
      var bucket = buckets[month];
      var result = { month: month, count: bucket.count, sum: pickValue ? fromMinor(bucket.minor, places) : null, items: bucket.items };
      return result;
    });
  };

  var minor = Object.freeze({
    sum: minorSum,
    toMinor: toMinor,
    fromMinor: fromMinor,
  });

  var helpers = {
    sum: sum,
    mean: mean,
    median: median,
    percentile: percentile,
    groupBy: groupBy,
    sortBy: sortBy,
    movingAverage: movingAverage,
    byMonth: byMonth,
    minor: minor,
  };

  Object.keys(helpers).forEach(function (name) {
    if (typeof helpers[name] === 'function') Object.freeze(helpers[name]);
    Object.defineProperty(g, name, { value: helpers[name], writable: false, configurable: false, enumerable: false });
  });

  ['SharedArrayBuffer', 'Atomics'].forEach(function (name) {
    delete g[name];
  });
})(globalThis);
`;

export const GUEST_DRIVER_SOURCE = `
(function (g) {
  'use strict';

  var codeText = g.__code;
  var inputText = g.__input;
  var outputLimit = g.__outputLimit;
  delete g.__code;
  delete g.__input;
  delete g.__outputLimit;

  var deepFreeze = function (root) {
    var stack = [root];
    while (stack.length > 0) {
      var value = stack.pop();
      if (value === null || typeof value !== 'object' || Object.isFrozen(value)) continue;
      Object.freeze(value);
      var keys = Object.keys(value);
      for (var i = 0; i < keys.length; i++) stack.push(value[keys[i]]);
    }
    return root;
  };

  var phase = 'syntax';
  try {
    var run = new Function('input', '"use strict";\\n' + codeText);
    phase = 'input';
    var input = deepFreeze(JSON.parse(inputText));
    phase = 'run';
    var result = run(input);
    if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
      throw new TypeError('Async code is not supported: return a plain object, not a promise');
    }
    phase = 'output';
    var text = JSON.stringify(result, function (key, value) {
      if (typeof value === 'number' && !isFinite(value)) {
        throw new TypeError('The output holds a number that is not finite' + (key === '' ? '' : ' at "' + key + '"'));
      }
      return value;
    });
    if (text === undefined) throw new TypeError('The code must return an object, but it returned nothing usable');
    if (text.length > outputLimit) return 'T' + text.length;
    return 'O' + text;
  } catch (error) {
    var name = 'Error';
    var message = '';
    try {
      name = String(error && error.name);
      message = String(error && error.message !== undefined ? error.message : error);
    } catch (ignored) {
      message = 'The code threw a value that cannot be read';
    }
    return 'E' + JSON.stringify({ phase: phase, name: name, message: message.slice(0, 500) });
  }
})(globalThis);
`;

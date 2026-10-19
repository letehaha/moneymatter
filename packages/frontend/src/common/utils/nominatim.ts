const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
const MIN_REQUEST_INTERVAL_MS = 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const SEARCH_RESULTS_LIMIT = 5;
const REVERSE_ZOOM = 16;
const MAX_LOCALITY_SEGMENTS = 2;

export interface PlaceResult {
  latitude: number;
  longitude: number;
  label: string;
  secondary: string;
}

interface NominatimAddress {
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  country?: string;
}

interface NominatimPlace {
  lat: string;
  lon: string;
  name?: string;
  display_name?: string;
  address?: NominatimAddress;
}

// ponytail: module-level 1 req/s throttle; a real queue only if we ever fire from several components at once
let nextSlotAt = 0;

export const resetNominatimThrottleForTests = () => {
  nextSlotAt = 0;
};

const abortError = ({ signal }: { signal?: AbortSignal }) =>
  signal?.reason ?? new DOMException('Aborted', 'AbortError');

const waitForSlot = async ({ signal }: { signal?: AbortSignal }) => {
  const wait = Math.max(0, nextSlotAt - Date.now());
  if (signal?.aborted) throw abortError({ signal });

  if (wait > 0) {
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortError({ signal }));
      };
      timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, wait);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  nextSlotAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
};

const request = async ({
  path,
  params,
  signal,
}: {
  path: string;
  params: Record<string, string>;
  signal?: AbortSignal;
}): Promise<unknown> => {
  await waitForSlot({ signal });

  const url = new URL(`${NOMINATIM_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url.toString(), {
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Nominatim ${path} failed: ${response.status} ${response.statusText}`);
  return response.json();
};

const splitDisplayName = ({ place }: { place: NominatimPlace }) =>
  (place.display_name ?? '')
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

export const formatPlaceLabel = ({ place }: { place: NominatimPlace }) => {
  const displayNameSegments = splitDisplayName({ place });
  const { suburb, city, town, village, country } = place.address ?? {};

  const segments = [
    place.name?.trim() || displayNameSegments[0],
    ...[suburb, city, town, village].filter(Boolean).slice(0, MAX_LOCALITY_SEGMENTS),
    country,
  ].filter((segment): segment is string => Boolean(segment));

  return [...new Set(segments)].join(', ');
};

const hasCoordinates = ({ place }: { place: NominatimPlace }) =>
  Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lon));

const toPlaceResult = ({ place }: { place: NominatimPlace }): PlaceResult => ({
  latitude: Number(place.lat),
  longitude: Number(place.lon),
  label: formatPlaceLabel({ place }),
  secondary: splitDisplayName({ place }).slice(1).join(', '),
});

export const searchPlaces = async ({
  query,
  signal,
  language,
}: {
  query: string;
  signal?: AbortSignal;
  language: string;
}): Promise<PlaceResult[]> => {
  const payload = (await request({
    path: '/search',
    params: {
      q: query,
      format: 'jsonv2',
      limit: String(SEARCH_RESULTS_LIMIT),
      addressdetails: '1',
      'accept-language': language,
    },
    signal,
  })) as NominatimPlace[] | null;

  if (!Array.isArray(payload)) return [];
  return payload.filter((place) => hasCoordinates({ place })).map((place) => toPlaceResult({ place }));
};

export const reverseGeocode = async ({
  latitude,
  longitude,
  signal,
  language,
}: {
  latitude: number;
  longitude: number;
  signal?: AbortSignal;
  language: string;
}): Promise<PlaceResult | null> => {
  const payload = (await request({
    path: '/reverse',
    params: {
      lat: String(latitude),
      lon: String(longitude),
      format: 'jsonv2',
      zoom: String(REVERSE_ZOOM),
      addressdetails: '1',
      'accept-language': language,
    },
    signal,
  })) as NominatimPlace | null;

  if (!payload || !hasCoordinates({ place: payload })) return null;
  return toPlaceResult({ place: payload });
};

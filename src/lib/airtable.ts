/**
 * GOR-140: Airtable API client.
 * Uses OAuth connection for authenticated requests.
 */
const AIRTABLE_API = 'https://api.airtable.com/v0';

async function airtableFetch(path: string, token: string, options?: RequestInit) {
  const res = await fetch(`${AIRTABLE_API}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) return { error: data.error?.message || `Airtable API error ${res.status}`, data: null };
  return { error: null, data };
}

export async function listBases(token: string) {
  return airtableFetch('/meta/bases', token);
}

export async function listTables(token: string, baseId: string) {
  return airtableFetch(`/meta/bases/${baseId}/tables`, token);
}

export async function listRecords(token: string, baseId: string, tableId: string, options?: { maxRecords?: number; view?: string; filterByFormula?: string }) {
  const params = new URLSearchParams();
  if (options?.maxRecords) params.set('maxRecords', String(options.maxRecords));
  if (options?.view) params.set('view', options.view);
  if (options?.filterByFormula) params.set('filterByFormula', options.filterByFormula);
  const query = params.toString() ? `?${params.toString()}` : '';
  return airtableFetch(`/${baseId}/${tableId}${query}`, token);
}

export async function getRecord(token: string, baseId: string, tableId: string, recordId: string) {
  return airtableFetch(`/${baseId}/${tableId}/${recordId}`, token);
}

export async function createRecord(token: string, baseId: string, tableId: string, fields: Record<string, unknown>) {
  return airtableFetch(`/${baseId}/${tableId}`, token, {
    method: 'POST',
    body: JSON.stringify({ fields }),
  });
}

export async function updateRecord(token: string, baseId: string, tableId: string, recordId: string, fields: Record<string, unknown>) {
  return airtableFetch(`/${baseId}/${tableId}/${recordId}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ fields }),
  });
}

export async function deleteRecord(token: string, baseId: string, tableId: string, recordId: string) {
  return airtableFetch(`/${baseId}/${tableId}/${recordId}`, token, {
    method: 'DELETE',
  });
}

export async function batchCreate(token: string, baseId: string, tableId: string, records: Array<{ fields: Record<string, unknown> }>) {
  // Airtable batch limit is 10
  const batches: typeof records[] = [];
  for (let i = 0; i < records.length; i += 10) {
    batches.push(records.slice(i, i + 10));
  }
  const results = [];
  for (const batch of batches) {
    const { data, error } = await airtableFetch(`/${baseId}/${tableId}`, token, {
      method: 'POST',
      body: JSON.stringify({ records: batch }),
    });
    if (error) return { error, data: null };
    results.push(...(data.records || []));
  }
  return { error: null, data: { records: results } };
}

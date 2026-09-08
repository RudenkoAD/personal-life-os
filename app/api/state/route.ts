import { loadState } from '@/db/store';
import { identity, json, errorResponse } from '@/lib/server';
export async function GET(request: Request) {
  try {
    const user = await identity(request);
    return json(await loadState(user.owner));
  } catch (e) {
    return errorResponse(e);
  }
}

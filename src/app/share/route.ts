import { NextResponse, type NextRequest } from 'next/server';
import { sharedToImportPath } from '@/lib/import/share';

/**
 * Target of "Share → Mestolo" (Web Share Target on Android PWAs, and the Android app's
 * share intent). A shared link opens the link import; plain text opens the text import.
 */
export function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const path = sharedToImportPath({ url: p.get('url'), text: p.get('text'), title: p.get('title') });
  return NextResponse.redirect(new URL(path, request.nextUrl.origin));
}

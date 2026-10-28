// Normalizza i report di violazione CSP (formato legacy `report-uri` e Reporting API `report-to`)
// in un oggetto piccolo e sicuro da loggare. Nessun valore del body viene fidato oltre il troncamento.

export type CspViolation = {
  blockedUri: string;
  documentUri: string;
  directive: string;
  disposition: string;
  sourceFile: string;
};

const MAX_FIELD = 300;

function str(v: unknown): string {
  return typeof v === 'string' ? v.slice(0, MAX_FIELD) : '';
}

function fromBody(b: Record<string, unknown>): CspViolation {
  return {
    blockedUri: str(b['blocked-uri'] ?? b.blockedURL ?? b.blockedURI),
    documentUri: str(b['document-uri'] ?? b.documentURL ?? b.documentURI),
    directive: str(b['effective-directive'] ?? b.effectiveDirective ?? b['violated-directive'] ?? b.violatedDirective),
    disposition: str(b.disposition),
    sourceFile: str(b['source-file'] ?? b.sourceFile),
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Estrae al massimo 10 violazioni da un body JSON gia parsato; ignora tutto cio che non e un report CSP. */
export function parseCspReports(payload: unknown): CspViolation[] {
  if (Array.isArray(payload)) {
    return payload
      .slice(0, 10)
      .filter((r): r is Record<string, unknown> => isObj(r) && r.type === 'csp-violation' && isObj(r.body))
      .map((r) => fromBody(r.body as Record<string, unknown>));
  }
  if (isObj(payload) && isObj(payload['csp-report'])) return [fromBody(payload['csp-report'])];
  return [];
}

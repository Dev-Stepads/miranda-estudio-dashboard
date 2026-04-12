/**
 * NF-e XML Parser.
 *
 * Parses the XML returned by GET /v1/notas-fiscais/{chave_acesso}
 * into a typed object for canonical mapping.
 *
 * The XML follows the Brazilian NF-e standard (nfeProc v4.00).
 * Key paths:
 *   NFe.infNFe.ide          → identification (nNF, dhEmi)
 *   NFe.infNFe.dest         → customer (CPF/CNPJ, xNome, enderDest)
 *   NFe.infNFe.det[]        → line items (prod.cProd, xProd, qCom, vProd)
 *   NFe.infNFe.total.ICMSTot → totals (vProd, vNF, vFrete, vDesc)
 *   NFe.infNFe.pag.detPag[] → payment (tPag, vPag)
 */

import { XMLParser } from 'fast-xml-parser';

// ------------------------------------------------------------
// Parsed types
// ------------------------------------------------------------

export interface ParsedNfe {
  chaveAcesso: string;
  numeroNota: number;
  dataEmissao: string;
  /** Customer info from <dest> */
  customer: {
    cpfCnpj: string;
    nome: string;
    uf: string | null;
    cidade: string | null;
    email: string | null;
    telefone: string | null;
  };
  /** Line items from <det> */
  items: ParsedNfeItem[];
  /** Totals from <total.ICMSTot> */
  totalProdutos: number;
  totalNota: number;
  totalFrete: number;
  totalDesconto: number;
  /** Payment method from <pag.detPag> */
  paymentMethod: string;
  paymentCode: string;
}

export interface ParsedNfeItem {
  /** Internal product code = SKU (cProd) */
  sku: string;
  /** Product name (xProd) */
  nome: string;
  /** Quantity (qCom) */
  quantidade: number;
  /** Unit price (vUnCom) */
  precoUnitario: number;
  /** Total price for this item (vProd) */
  precoTotal: number;
  /** Barcode EAN (cEAN), may be "SEM GTIN" */
  ean: string | null;
}

// ------------------------------------------------------------
// Payment code → readable name
// ------------------------------------------------------------

const PAYMENT_CODES: Record<string, string> = {
  '01': 'Dinheiro',
  '02': 'Cheque',
  '03': 'Cartão de Crédito',
  '04': 'Cartão de Débito',
  '05': 'Crédito Loja',
  '10': 'Vale Alimentação',
  '11': 'Vale Refeição',
  '12': 'Vale Presente',
  '13': 'Vale Combustível',
  '14': 'Duplicata Mercantil',
  '15': 'Boleto Bancário',
  '16': 'Depósito Bancário',
  '17': 'PIX',
  '18': 'Transferência Bancária',
  '19': 'Cashback / Crédito Virtual',
  '90': 'Sem Pagamento',
  '99': 'Outros',
};

function paymentCodeToName(code: string): string {
  return PAYMENT_CODES[code] ?? `Código ${code}`;
}

// ------------------------------------------------------------
// Parser
// ------------------------------------------------------------

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Force these tags to always be arrays (XML returns object when single item)
  isArray: (_name, jpath) => {
    return jpath === 'nfeProc.NFe.infNFe.det' ||
           jpath === 'nfeProc.NFe.infNFe.pag.detPag' ||
           jpath === 'nfeProc.NFe.infNFe.autXML' ||
           jpath === 'nfeProc.NFe.infNFe.cobr.dup';
  },
});

/**
 * Parse a raw NF-e XML string into a structured object.
 * Throws if the XML is malformed or missing critical fields.
 */
export function parseNfeXml(xml: string, chaveAcesso: string): ParsedNfe {
  const doc = xmlParser.parse(xml);

  const nfe = doc?.nfeProc?.NFe;
  if (!nfe) throw new Error(`NF-e XML missing <NFe> root for chave ${chaveAcesso}`);

  const infNFe = nfe.infNFe;
  if (!infNFe) throw new Error(`NF-e XML missing <infNFe> for chave ${chaveAcesso}`);

  const ide = infNFe.ide ?? {};
  const dest = infNFe.dest ?? {};
  const enderDest = dest.enderDest ?? {};
  const totalNode = infNFe.total?.ICMSTot ?? {};
  const detArray: unknown[] = Array.isArray(infNFe.det) ? infNFe.det : (infNFe.det ? [infNFe.det] : []);
  const pagNode = infNFe.pag ?? {};
  const detPagArray: unknown[] = Array.isArray(pagNode.detPag) ? pagNode.detPag : (pagNode.detPag ? [pagNode.detPag] : []);

  // Parse items
  const items: ParsedNfeItem[] = detArray.map((det: unknown) => {
    const d = det as Record<string, unknown>;
    const prod = (d.prod ?? {}) as Record<string, unknown>;
    const ean = String(prod.cEAN ?? '');
    return {
      sku: String(prod.cProd ?? ''),
      nome: String(prod.xProd ?? ''),
      quantidade: Number(prod.qCom ?? 0),
      precoUnitario: Number(prod.vUnCom ?? 0),
      precoTotal: Number(prod.vProd ?? 0),
      ean: ean === 'SEM GTIN' || ean === '' ? null : ean,
    };
  });

  // Parse payment
  const firstPag = (detPagArray[0] ?? {}) as Record<string, unknown>;
  const paymentCode = String(firstPag.tPag ?? '99');

  // Parse customer document (CPF or CNPJ)
  const cpfCnpj = String(dest.CPF ?? dest.CNPJ ?? '');

  return {
    chaveAcesso,
    numeroNota: Number(ide.nNF ?? 0),
    dataEmissao: String(ide.dhEmi ?? ''),
    customer: {
      cpfCnpj,
      nome: String(dest.xNome ?? ''),
      uf: enderDest.UF ? String(enderDest.UF) : null,
      cidade: enderDest.xMun ? String(enderDest.xMun) : null,
      email: dest.email ? String(dest.email) : null,
      telefone: enderDest.fone ? String(enderDest.fone) : null,
    },
    items,
    totalProdutos: Number(totalNode.vProd ?? 0),
    totalNota: Number(totalNode.vNF ?? 0),
    totalFrete: Number(totalNode.vFrete ?? 0),
    totalDesconto: Number(totalNode.vDesc ?? 0),
    paymentMethod: paymentCodeToName(paymentCode),
    paymentCode,
  };
}

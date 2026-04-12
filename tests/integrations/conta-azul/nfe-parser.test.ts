/**
 * Tests for NF-e XML parser.
 */

import { describe, expect, it } from 'vitest';
import { parseNfeXml } from '../../../src/integrations/conta-azul/nfe-parser.ts';

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe versao="4.00" Id="NFe29260430938298000146550010000037631416089300">
      <ide>
        <nNF>3763</nNF>
        <dhEmi>2026-04-10T17:42:39-03:00</dhEmi>
        <tpNF>1</tpNF>
      </ide>
      <emit>
        <CNPJ>30938298000146</CNPJ>
        <xNome>MIRANDA ESTUDIO</xNome>
      </emit>
      <dest>
        <CPF>02667427505</CPF>
        <xNome>Mariana Nascimento</xNome>
        <enderDest>
          <UF>BA</UF>
          <xMun>Salvador</xMun>
          <fone>7199626655</fone>
        </enderDest>
        <email>mariana@example.com</email>
      </dest>
      <det nItem="1">
        <prod>
          <cProd>MIR0178PRE</cProd>
          <cEAN>7892871727017</cEAN>
          <xProd>Espreguicadeira Escute A Sua Preguica (Preto)</xProd>
          <qCom>1.0000</qCom>
          <vUnCom>660.0000000000</vUnCom>
          <vProd>660.00</vProd>
        </prod>
      </det>
      <det nItem="2">
        <prod>
          <cProd>MIR0182FEL</cProd>
          <cEAN>SEM GTIN</cEAN>
          <xProd>Cartao Feliz Vida Toda</xProd>
          <qCom>1.0000</qCom>
          <vUnCom>25.0000000000</vUnCom>
          <vProd>25.00</vProd>
        </prod>
      </det>
      <total>
        <ICMSTot>
          <vProd>685.00</vProd>
          <vFrete>0.00</vFrete>
          <vDesc>0.00</vDesc>
          <vNF>685.00</vNF>
        </ICMSTot>
      </total>
      <pag>
        <detPag>
          <tPag>03</tPag>
          <vPag>685.00</vPag>
        </detPag>
      </pag>
    </infNFe>
  </NFe>
</nfeProc>`;

const CHAVE = '29260430938298000146550010000037631416089300';

describe('parseNfeXml', () => {
  it('extracts basic identification fields', () => {
    const nfe = parseNfeXml(SAMPLE_XML, CHAVE);
    expect(nfe.chaveAcesso).toBe(CHAVE);
    expect(nfe.numeroNota).toBe(3763);
    expect(nfe.dataEmissao).toBe('2026-04-10T17:42:39-03:00');
  });

  it('extracts customer data from <dest>', () => {
    const nfe = parseNfeXml(SAMPLE_XML, CHAVE);
    expect(nfe.customer.cpfCnpj).toBe('02667427505');
    expect(nfe.customer.nome).toBe('Mariana Nascimento');
    expect(nfe.customer.uf).toBe('BA');
    expect(nfe.customer.cidade).toBe('Salvador');
    expect(nfe.customer.email).toBe('mariana@example.com');
    expect(nfe.customer.telefone).toBe('7199626655');
  });

  it('extracts line items from <det> array', () => {
    const nfe = parseNfeXml(SAMPLE_XML, CHAVE);
    expect(nfe.items).toHaveLength(2);

    expect(nfe.items[0]!.sku).toBe('MIR0178PRE');
    expect(nfe.items[0]!.nome).toBe('Espreguicadeira Escute A Sua Preguica (Preto)');
    expect(nfe.items[0]!.quantidade).toBe(1);
    expect(nfe.items[0]!.precoUnitario).toBe(660);
    expect(nfe.items[0]!.precoTotal).toBe(660);
    expect(nfe.items[0]!.ean).toBe('7892871727017');

    expect(nfe.items[1]!.sku).toBe('MIR0182FEL');
    expect(nfe.items[1]!.nome).toBe('Cartao Feliz Vida Toda');
    expect(nfe.items[1]!.ean).toBeNull(); // "SEM GTIN" → null
  });

  it('extracts totals from <ICMSTot>', () => {
    const nfe = parseNfeXml(SAMPLE_XML, CHAVE);
    expect(nfe.totalProdutos).toBe(685);
    expect(nfe.totalNota).toBe(685);
    expect(nfe.totalFrete).toBe(0);
    expect(nfe.totalDesconto).toBe(0);
  });

  it('maps payment code to readable name', () => {
    const nfe = parseNfeXml(SAMPLE_XML, CHAVE);
    expect(nfe.paymentCode).toBe('03');
    expect(nfe.paymentMethod).toBe('Cartão de Crédito');
  });

  it('handles EAN "SEM GTIN" as null', () => {
    const nfe = parseNfeXml(SAMPLE_XML, CHAVE);
    expect(nfe.items[1]!.ean).toBeNull();
  });

  it('handles single <det> (not array) correctly', () => {
    const singleItemXml = SAMPLE_XML
      .replace(/<det nItem="2">[\s\S]*?<\/det>/, ''); // remove second item

    const nfe = parseNfeXml(singleItemXml, CHAVE);
    expect(nfe.items).toHaveLength(1);
    expect(nfe.items[0]!.sku).toBe('MIR0178PRE');
  });

  it('throws on malformed XML (missing <NFe>)', () => {
    expect(() => parseNfeXml('<root></root>', CHAVE)).toThrow('missing <NFe>');
  });

  it('maps common payment codes correctly', () => {
    function xmlWithPayment(tPag: string): string {
      return SAMPLE_XML.replace('<tPag>03</tPag>', `<tPag>${tPag}</tPag>`);
    }

    expect(parseNfeXml(xmlWithPayment('01'), CHAVE).paymentMethod).toBe('Dinheiro');
    expect(parseNfeXml(xmlWithPayment('04'), CHAVE).paymentMethod).toBe('Cartão de Débito');
    expect(parseNfeXml(xmlWithPayment('17'), CHAVE).paymentMethod).toBe('PIX');
    expect(parseNfeXml(xmlWithPayment('15'), CHAVE).paymentMethod).toBe('Boleto Bancário');
    expect(parseNfeXml(xmlWithPayment('99'), CHAVE).paymentMethod).toBe('Outros');
  });

  it('handles missing <dest> fields gracefully', () => {
    const noEmailXml = SAMPLE_XML.replace('<email>mariana@example.com</email>', '');
    const nfe = parseNfeXml(noEmailXml, CHAVE);
    expect(nfe.customer.email).toBeNull();
  });

  it('extracts CNPJ when dest has CNPJ instead of CPF', () => {
    const cnpjXml = SAMPLE_XML.replace(
      '<CPF>02667427505</CPF>',
      '<CNPJ>30938298000146</CNPJ>',
    );
    const nfe = parseNfeXml(cnpjXml, CHAVE);
    expect(nfe.customer.cpfCnpj).toBe('30938298000146');
  });
});

import { AFRelationship, PDFDocument, PDFHeader, PDFName, PDFString } from 'pdf-lib';
import { SRGB_ICC_BASE64 } from './srgbProfile';

/**
 * PDF/A-3b für alle ausgegebenen Belege (Rechnung, Storno, Angebot, Mahnung).
 * Ergänzt das jsPDF-Ergebnis um XMP-Metadaten, sRGB-OutputIntent und – bei ZUGFeRD –
 * den Anhang `factur-x.xml` mit Factur-X-Erweiterungsschema.
 * Voraussetzung: eingebettete Schriften (pdfFonts.ts), feste Datei-ID (pdfIdentity.ts).
 * Prüfung: scripts/pdfa-validate.sh (veraPDF/Mustang).
 */

export const PDF_PRODUCER = 'OpenBills';
export const FACTURX_FILENAME = 'factur-x.xml';
const FACTURX_NS = 'urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#';

export interface PdfAMetadata {
  title: string;
  /** Erstell- und Änderungsdatum (Belegdatum, reproduzierbar) */
  date: Date;
}

export interface FacturXAttachment {
  xml: string;
  /** fx:ConformanceLevel; das CII-XML nutzt die XRechnung-Spezifikationskennung */
  conformanceLevel: 'XRECHNUNG' | 'EN 16931';
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** XMP-Datum ohne Millisekunden, passend zum Info-Dictionary (`D:YYYYMMDDHHmmSSZ`). */
const xmpDate = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

const facturXProperty = (name: string, description: string) => `
              <rdf:li rdf:parseType="Resource">
                <pdfaProperty:name>${name}</pdfaProperty:name>
                <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                <pdfaProperty:category>external</pdfaProperty:category>
                <pdfaProperty:description>${description}</pdfaProperty:description>
              </rdf:li>`;

function facturXDescriptions(level: FacturXAttachment['conformanceLevel']): string {
  return `
    <rdf:Description rdf:about=""
        xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
        xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
        xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>${FACTURX_NS}</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>${facturXProperty('DocumentFileName', 'name of the embedded XML invoice file')}${facturXProperty('DocumentType', 'INVOICE')}${facturXProperty('Version', 'The actual version of the Factur-X XML schema')}${facturXProperty('ConformanceLevel', 'The conformance level of the embedded Factur-X data')}
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:fx="${FACTURX_NS}">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>${FACTURX_FILENAME}</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>${level}</fx:ConformanceLevel>
    </rdf:Description>`;
}

/** Byte Order Mark im xpacket-Kopf (XMP-Spezifikation) */
const BOM = '\uFEFF';

export function buildXmp(meta: PdfAMetadata, facturX?: FacturXAttachment): string {
  const date = xmpDate(meta.date);
  return `<?xpacket begin="${BOM}" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:format>application/pdf</dc:format>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(meta.title)}</rdf:li></rdf:Alt></dc:title>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>${PDF_PRODUCER}</xmp:CreatorTool>
      <xmp:CreateDate>${date}</xmp:CreateDate>
      <xmp:ModifyDate>${date}</xmp:ModifyDate>
      <xmp:MetadataDate>${date}</xmp:MetadataDate>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <pdf:Producer>${PDF_PRODUCER}</pdf:Producer>
    </rdf:Description>${facturX ? facturXDescriptions(facturX.conformanceLevel) : ''}
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

const iccBytes = () => Uint8Array.from(atob(SRGB_ICC_BASE64), c => c.charCodeAt(0));

/** Macht aus einem jsPDF-Ergebnis ein PDF/A-3b (optional mit ZUGFeRD-/Factur-X-XML). */
export async function finalizePdfA(
  pdfBytes: ArrayBuffer,
  meta: PdfAMetadata,
  facturX?: FacturXAttachment
): Promise<Uint8Array> {
  // updateMetadata: false – sonst setzt pdf-lib Producer und Datum auf „jetzt“
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const { context, catalog } = doc;
  context.header = PDFHeader.forVersion(1, 7);

  // Info-Dictionary muss den XMP-Werten entsprechen
  doc.setTitle(meta.title);
  doc.setProducer(PDF_PRODUCER);
  doc.setCreator(PDF_PRODUCER);
  doc.setCreationDate(meta.date);
  doc.setModificationDate(meta.date);

  if (facturX) {
    await doc.attach(new TextEncoder().encode(facturX.xml), FACTURX_FILENAME, {
      mimeType: 'text/xml',
      description: 'Factur-X/ZUGFeRD-Rechnungsdaten',
      creationDate: meta.date,
      modificationDate: meta.date,
      afRelationship: AFRelationship.Alternative,
    });
  }

  const profile = context.register(context.flateStream(iccBytes(), { N: 3 }));
  const outputIntent = context.register(context.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    RegistryName: PDFString.of('http://www.color.org'),
    DestOutputProfile: profile,
  }));
  catalog.set(PDFName.of('OutputIntents'), context.obj([outputIntent]));

  // Metadaten-Stream ohne Filter (PDF/A), UTF-8
  const metadata = context.register(context.stream(new TextEncoder().encode(buildXmp(meta, facturX)), { Type: 'Metadata', Subtype: 'XML' }));
  catalog.set(PDFName.of('Metadata'), metadata);

  return doc.save({ useObjectStreams: false, addDefaultPage: false });
}

/** Wie `finalizePdfA`, als Blob. */
export async function finalizePdfABlob(pdfBytes: ArrayBuffer, meta: PdfAMetadata, facturX?: FacturXAttachment): Promise<Blob> {
  return new Blob([await finalizePdfA(pdfBytes, meta, facturX)], { type: 'application/pdf' });
}

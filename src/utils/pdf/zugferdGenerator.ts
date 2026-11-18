/**
 * ZUGFeRD XML generator
 * Generates ZUGFeRD 2.1 compliant XML based on EN 16931 standard
 */

import { finalizePdfABlob } from './pdfA';
import { documentDate } from './pdfIdentity';
import { Invoice } from '../../types';
import { PDFOptions } from '../pdfGenerator';
import { escapeXML, formatAmountForXML, roundToCents, getCountryCode, vatIdentifier } from './xmlUtils';
import { hasOnlyZeroTaxRate, getTaxCategoryCode, getTaxExemptionReason } from './taxCalculations';
import { calculateInvoiceWithDiscounts } from '../discountUtils';
import { isCancellation, amountSign, toPositiveBase, cancelledInvoiceRef, cancellationNote } from './cancellation';

/**
 * Generate ZUGFeRD XML string
 * @param invoice - Invoice data
 * @param options - PDF options with company and customer data
 * @returns ZUGFeRD XML string
 */
export function generateZUGFeRDXML(source: Invoice, options: PDFOptions): string {
  // Stornorechnung: 384 + Bezug (BG-3), Rechnen auf positiver Basis, Vorzeichen bei der Ausgabe
  const cancellation = isCancellation(source);
  const ref = cancellation ? cancelledInvoiceRef(source) : null;
  const sign = amountSign(source);
  const invoice = toPositiveBase(source);
  /** Betrag mit Vorzeichen des Belegs (Storno negativ), nie "-0.00". */
  const amount = (value: number) => formatAmountForXML(roundToCents(sign * value) || 0);
  const date102 = (isoDate: string) => isoDate.replace(/-/g, '');

  // Use new payment information or fall back to legacy fields
  const paymentInfo = options.company.paymentInformation;

  // Alle Beträge aus der Cent-genauen Berechnung (BR-CO-10/13/14/15, BR-S-08), nicht aus den
  // gespeicherten Summen: die können bei Rechnungen vor der Umstellung um einen Cent abweichen.
  const calc = calculateInvoiceWithDiscounts(
    invoice.items,
    { type: invoice.globalDiscountType, value: invoice.globalDiscountValue },
    options.company.isSmallBusiness
  );
  const taxBreakdownEntries = Object.entries(calc.taxBreakdown)
    .sort(([rateA], [rateB]) => Number(rateA) - Number(rateB));
  const headerTaxAmount = calc.taxAmount;
  const headerLineExtensionAmount = calc.subtotalAfterItemDiscounts;
  // Gesamtrabatt als ein Rabatt je Steuersatz (BR-CO-11/BR-S-08), Anteile ergeben in Summe den Gesamtrabatt
  const documentAllowances = taxBreakdownEntries
    .map(([rate, breakdown]) => ({
      rate,
      categoryCode: getTaxCategoryCode(Number(rate), options.company.isSmallBusiness),
      amount: breakdown.globalDiscountShare ?? 0,
    }))
    .filter(allowance => allowance.amount > 0);
  const allowanceTotalAmount = calc.globalDiscountAmount;
  const taxExclusiveAmount = calc.discountedSubtotal;
  const grandTotalAmount = calc.total;
  // BT-48: USt-ID des Käufers (Pflicht bei Reverse Charge, BR-AE-02)
  const buyerVatId = vatIdentifier(options.customer.taxId);

  // Generate proper ZUGFeRD 2.1 XML (EN 16931 compliant)
  return `<?xml version="1.0" encoding="UTF-8"?>

<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
	<rsm:ExchangedDocumentContext>
		<ram:BusinessProcessSpecifiedDocumentContextParameter>
			<ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID>
		</ram:BusinessProcessSpecifiedDocumentContextParameter>
		<ram:GuidelineSpecifiedDocumentContextParameter>
			<ram:ID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</ram:ID>
		</ram:GuidelineSpecifiedDocumentContextParameter>
	</rsm:ExchangedDocumentContext>
  
	<rsm:ExchangedDocument>
		<ram:ID>${escapeXML(invoice.invoiceNumber)}</ram:ID>
		<ram:TypeCode>${cancellation ? '384' : '380'}</ram:TypeCode>
		<ram:IssueDateTime>
			<udt:DateTimeString format="102">${new Date(invoice.issueDate).toISOString().split('T')[0].replace(/-/g, '')}</udt:DateTimeString>
		</ram:IssueDateTime>
		<ram:IncludedNote>
			<ram:Content>  ${(() => {
        // Use new payment information structure for ZUGFeRD
        const bankAccount = paymentInfo?.bankAccount || options.company.bankAccount || '';
        const bic = paymentInfo?.bic || options.company.bic || 'COBADEFFXXX';
        const accountHolder = paymentInfo?.accountHolder || options.company.name;
        
        const bankInfo = `${accountHolder} - BIC: ${bic}  IBAN: ${bankAccount}`;
        const reverseChargeNote = hasOnlyZeroTaxRate(invoice.items)
          ? getTaxExemptionReason(getTaxCategoryCode(0, options.company.isSmallBusiness))
          : '';

        return [cancellation ? escapeXML(cancellationNote(source)) : '', bankInfo, reverseChargeNote].filter(Boolean).join('\n');
      })()}</ram:Content>
		</ram:IncludedNote>
	</rsm:ExchangedDocument>
  
	<rsm:SupplyChainTradeTransaction>
		${invoice.items.map((item, index) => {
    // Bei Kleinunternehmerregelung denselben normalisierten Satz verwenden wie
    // die Kopf-Aufschlüsselung — sonst meldet die Position S/19%, während der
    // Kopf nur eine E/0%-Gruppe führt (Validator lehnt ab, BR-S-05).
    const effectiveTaxRate = options.company.isSmallBusiness ? 0 : item.taxRate;
    return `<ram:IncludedSupplyChainTradeLineItem>
			<ram:AssociatedDocumentLineDocument>
				<ram:LineID>${index + 1}</ram:LineID>
			</ram:AssociatedDocumentLineDocument>
			<ram:SpecifiedTradeProduct>
				<ram:SellerAssignedID>ITEM-${index + 1}</ram:SellerAssignedID>
				<ram:Name>${escapeXML(item.description)}</ram:Name>
				<ram:Description>${escapeXML(item.description)}</ram:Description>
			</ram:SpecifiedTradeProduct>
			<ram:SpecifiedLineTradeAgreement>
				<ram:NetPriceProductTradePrice>
					<ram:ChargeAmount>${formatAmountForXML(item.unitPrice)}</ram:ChargeAmount>
					<ram:BasisQuantity unitCode="C62">1</ram:BasisQuantity>
				</ram:NetPriceProductTradePrice>
			</ram:SpecifiedLineTradeAgreement>
			<ram:SpecifiedLineTradeDelivery>
				<ram:BilledQuantity unitCode="C62">${sign * item.quantity}</ram:BilledQuantity>
			</ram:SpecifiedLineTradeDelivery>
			<ram:SpecifiedLineTradeSettlement>
				<ram:ApplicableTradeTax>
					<ram:TypeCode>VAT</ram:TypeCode>
					<ram:CategoryCode>${getTaxCategoryCode(effectiveTaxRate, options.company.isSmallBusiness)}</ram:CategoryCode>
					<ram:RateApplicablePercent>${effectiveTaxRate}</ram:RateApplicablePercent>
				</ram:ApplicableTradeTax>${calc.lines[index].discount > 0 ? `
				<ram:SpecifiedTradeAllowanceCharge>
					<ram:ChargeIndicator>
						<udt:Indicator>false</udt:Indicator>
					</ram:ChargeIndicator>
					<ram:ActualAmount>${amount(calc.lines[index].discount)}</ram:ActualAmount>
					<ram:Reason>Rabatt</ram:Reason>
				</ram:SpecifiedTradeAllowanceCharge>` : ''}
				<ram:SpecifiedTradeSettlementLineMonetarySummation>
					<ram:LineTotalAmount>${amount(calc.lines[index].net)}</ram:LineTotalAmount>
				</ram:SpecifiedTradeSettlementLineMonetarySummation>
			</ram:SpecifiedLineTradeSettlement>
		</ram:IncludedSupplyChainTradeLineItem>`;
  }).join('')}
		<ram:ApplicableHeaderTradeAgreement>
			<ram:BuyerReference>${options.customer.customerNumber || '0010'}</ram:BuyerReference>
			<ram:SellerTradeParty>
				<ram:Name>${escapeXML(options.company.name)}</ram:Name>
				<ram:SpecifiedLegalOrganization>
					<ram:TradingBusinessName>${escapeXML(options.company.name)}</ram:TradingBusinessName>
				</ram:SpecifiedLegalOrganization>
				<ram:DefinedTradeContact>
					<ram:PersonName>${escapeXML(options.company.name)}</ram:PersonName>
					<ram:TelephoneUniversalCommunication>
						<ram:CompleteNumber>${options.company.phone || '+49 30 12345678'}</ram:CompleteNumber>
					</ram:TelephoneUniversalCommunication>
					<ram:EmailURIUniversalCommunication>
						<ram:URIID>${options.company.email}</ram:URIID>
					</ram:EmailURIUniversalCommunication>
				</ram:DefinedTradeContact>
				<ram:PostalTradeAddress>
					<ram:PostcodeCode>${options.company.postalCode}</ram:PostcodeCode>
					<ram:LineOne>${escapeXML(options.company.address)}</ram:LineOne>
					<ram:CityName>${escapeXML(options.company.city)}</ram:CityName>
					<ram:CountryID>${getCountryCode(options.company.country)}</ram:CountryID>
				</ram:PostalTradeAddress>
				<ram:URIUniversalCommunication>
					<ram:URIID schemeID="EM">${options.company.email}</ram:URIID>
				</ram:URIUniversalCommunication>
				<ram:SpecifiedTaxRegistration>
					<ram:ID schemeID="VA">${options.company.taxId}</ram:ID>
				</ram:SpecifiedTaxRegistration>
			</ram:SellerTradeParty>
			<ram:BuyerTradeParty>
				<ram:Name>${escapeXML(options.customer.name)}</ram:Name>
				<ram:PostalTradeAddress>
					<ram:PostcodeCode>${options.customer.postalCode}</ram:PostcodeCode>
					<ram:LineOne>${escapeXML(options.customer.address)}${options.customer.addressSupplement ? ', ' + escapeXML(options.customer.addressSupplement) : ''}</ram:LineOne>
					<ram:CityName>${escapeXML(options.customer.city)}</ram:CityName>
					<ram:CountryID>${getCountryCode(options.customer.country)}</ram:CountryID>
				</ram:PostalTradeAddress>
				<ram:URIUniversalCommunication>
					<ram:URIID schemeID="EM">${options.customer.email || 'kunde@example.de'}</ram:URIID>
				</ram:URIUniversalCommunication>${buyerVatId ? `
				<ram:SpecifiedTaxRegistration>
					<ram:ID schemeID="VA">${escapeXML(buyerVatId)}</ram:ID>
				</ram:SpecifiedTaxRegistration>` : ''}
			</ram:BuyerTradeParty>
		</ram:ApplicableHeaderTradeAgreement>
		<ram:ApplicableHeaderTradeDelivery>
			<ram:ActualDeliverySupplyChainEvent>
				<ram:OccurrenceDateTime>
					<udt:DateTimeString format="102">${ref ? date102(ref.issueDate) : new Date(invoice.issueDate).toISOString().split('T')[0].replace(/-/g, '')}</udt:DateTimeString>
				</ram:OccurrenceDateTime>
			</ram:ActualDeliverySupplyChainEvent>
		</ram:ApplicableHeaderTradeDelivery>
		<ram:ApplicableHeaderTradeSettlement>
			<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
			<ram:SpecifiedTradeSettlementPaymentMeans>
				<ram:TypeCode>58</ram:TypeCode>
				<ram:Information>SEPA credit transfer</ram:Information>
				<ram:PayeePartyCreditorFinancialAccount>
					<ram:IBANID>${(paymentInfo?.bankAccount || options.company.bankAccount || 'DE89370400440532013000').replace(/\s/g, '')}</ram:IBANID>
					<ram:AccountName>${escapeXML(paymentInfo?.accountHolder || options.company.name)}</ram:AccountName>
				</ram:PayeePartyCreditorFinancialAccount>
				<ram:PayeeSpecifiedCreditorFinancialInstitution>
					<ram:BICID>${paymentInfo?.bic || options.company.bic || 'COBADEFFXXX'}</ram:BICID>
				</ram:PayeeSpecifiedCreditorFinancialInstitution>
			</ram:SpecifiedTradeSettlementPaymentMeans>
			${taxBreakdownEntries
				.map(([rate, breakdown]) => {
					const categoryCode = getTaxCategoryCode(Number(rate), options.company.isSmallBusiness);
					const exemptionReason = getTaxExemptionReason(categoryCode);
					return `<ram:ApplicableTradeTax>
				<ram:CalculatedAmount>${amount(breakdown.taxAmount)}</ram:CalculatedAmount>
				<ram:TypeCode>VAT</ram:TypeCode>${exemptionReason ? `
				<ram:ExemptionReason>${escapeXML(exemptionReason)}</ram:ExemptionReason>` : ''}
				<ram:BasisAmount>${amount(breakdown.taxableAmount)}</ram:BasisAmount>
				<ram:CategoryCode>${categoryCode}</ram:CategoryCode>
				<ram:RateApplicablePercent>${rate}</ram:RateApplicablePercent>
			</ram:ApplicableTradeTax>`;
				}).join('')}${documentAllowances.map(allowance => `
			<ram:SpecifiedTradeAllowanceCharge>
				<ram:ChargeIndicator>
					<udt:Indicator>false</udt:Indicator>
				</ram:ChargeIndicator>
				<ram:ActualAmount>${amount(allowance.amount)}</ram:ActualAmount>
				<ram:Reason>Rabatt</ram:Reason>
				<ram:CategoryTradeTax>
					<ram:TypeCode>VAT</ram:TypeCode>
					<ram:CategoryCode>${allowance.categoryCode}</ram:CategoryCode>
					<ram:RateApplicablePercent>${allowance.rate}</ram:RateApplicablePercent>
				</ram:CategoryTradeTax>
			</ram:SpecifiedTradeAllowanceCharge>`).join('')}
			<ram:SpecifiedTradePaymentTerms>
				<ram:Description>/</ram:Description>
				<ram:DueDateDateTime>
					<udt:DateTimeString format="102">${new Date(invoice.dueDate).toISOString().split('T')[0].replace(/-/g, '')}</udt:DateTimeString>
				</ram:DueDateDateTime>
			</ram:SpecifiedTradePaymentTerms>
			<ram:SpecifiedTradeSettlementHeaderMonetarySummation>
				<ram:LineTotalAmount>${amount(headerLineExtensionAmount)}</ram:LineTotalAmount>
				${allowanceTotalAmount > 0 ? `<ram:AllowanceTotalAmount>${amount(allowanceTotalAmount)}</ram:AllowanceTotalAmount>` : ''}
				<ram:TaxBasisTotalAmount>${amount(taxExclusiveAmount)}</ram:TaxBasisTotalAmount>
				<ram:TaxTotalAmount currencyID="EUR">${amount(headerTaxAmount)}</ram:TaxTotalAmount>
				<ram:GrandTotalAmount>${amount(grandTotalAmount)}</ram:GrandTotalAmount>
				<ram:DuePayableAmount>${amount(grandTotalAmount)}</ram:DuePayableAmount>
			</ram:SpecifiedTradeSettlementHeaderMonetarySummation>${ref ? `
			<ram:InvoiceReferencedDocument>
				<ram:IssuerAssignedID>${escapeXML(ref.invoiceNumber)}</ram:IssuerAssignedID>
				<ram:FormattedIssueDateTime>
					<qdt:DateTimeString format="102">${date102(ref.issueDate)}</qdt:DateTimeString>
				</ram:FormattedIssueDateTime>
			</ram:InvoiceReferencedDocument>` : ''}
		</ram:ApplicableHeaderTradeSettlement>
	</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
}

/**
 * Bettet das ZUGFeRD-XML als `factur-x.xml` in ein PDF/A-3b ein.
 * Wirft bei Fehlern: ein PDF ohne XML darf nicht als ZUGFeRD ausgegeben oder archiviert werden.
 */
export async function embedZUGFeRDXMLIntoPDF(pdfBuffer: ArrayBuffer, invoice: Invoice, options: PDFOptions): Promise<Blob> {
  const xml = generateZUGFeRDXML(invoice, options);
  if (!xml.trim()) {
    throw new Error('ZUGFeRD-XML ist leer');
  }
  return finalizePdfABlob(
    pdfBuffer,
    {
      title: `${isCancellation(invoice) ? 'Stornorechnung' : 'Rechnung'} ${invoice.invoiceNumber}`,
      date: documentDate(invoice.issueDate),
    },
    { xml, conformanceLevel: 'XRECHNUNG' }
  );
}



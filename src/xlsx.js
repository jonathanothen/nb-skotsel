/**
 * Skapar en Excel-fil (.xlsx) i webbläsaren utan externa bibliotek.
 * sheets = [{ name, rows: [[cell, …], …] }]; första raden är rubriker (fet, fryst, filter).
 * Tal sparas som tal, allt annat som text.
 */

const CRC = ( () => {
	const t = new Uint32Array( 256 );
	for ( let n = 0; n < 256; n++ ) {
		let c = n;
		for ( let k = 0; k < 8; k++ ) {
			c = c & 1 ? 0xedb88320 ^ ( c >>> 1 ) : c >>> 1;
		}
		t[ n ] = c >>> 0;
	}
	return t;
} )();
const crc32 = ( b ) => {
	let c = 0xffffffff;
	for ( let i = 0; i < b.length; i++ ) {
		c = CRC[ ( c ^ b[ i ] ) & 0xff ] ^ ( c >>> 8 );
	}
	return ( c ^ 0xffffffff ) >>> 0;
};

/** Okomprimerad zip. */
function zip( files ) {
	const enc = new TextEncoder();
	const parts = [];
	const central = [];
	let offset = 0;
	const head = ( size, sig ) => {
		const v = new DataView( new ArrayBuffer( size ) );
		v.setUint32( 0, sig, true );
		return v;
	};
	files.forEach( ( f ) => {
		const name = enc.encode( f.name );
		const data = enc.encode( f.data );
		const crc = crc32( data );
		const h = head( 30, 0x04034b50 );
		h.setUint16( 4, 20, true );
		h.setUint16( 6, 0x0800, true );
		h.setUint32( 14, crc, true );
		h.setUint32( 18, data.length, true );
		h.setUint32( 22, data.length, true );
		h.setUint16( 26, name.length, true );
		const c = head( 46, 0x02014b50 );
		c.setUint16( 4, 20, true );
		c.setUint16( 6, 20, true );
		c.setUint16( 8, 0x0800, true );
		c.setUint32( 16, crc, true );
		c.setUint32( 20, data.length, true );
		c.setUint32( 24, data.length, true );
		c.setUint16( 28, name.length, true );
		c.setUint32( 42, offset, true );
		parts.push( h.buffer, name, data );
		central.push( c.buffer, name );
		offset += 30 + name.length + data.length;
	} );
	const size = central.reduce( ( s, p ) => s + ( p.byteLength || p.length ), 0 );
	const e = head( 22, 0x06054b50 );
	e.setUint16( 8, files.length, true );
	e.setUint16( 10, files.length, true );
	e.setUint32( 12, size, true );
	e.setUint32( 16, offset, true );
	return new Blob( [ ...parts, ...central, e.buffer ], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } );
}

const x = ( s ) =>
	String( s ?? '' )
		.replace( /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '' )
		.replace( /[&<>"]/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ c ] ) );
const col = ( n ) => {
	let s = '';
	for ( n++; n > 0; n = Math.floor( ( n - 1 ) / 26 ) ) {
		s = String.fromCharCode( 65 + ( ( n - 1 ) % 26 ) ) + s;
	}
	return s;
};
/** Excel tillåter inte vissa tecken i bladnamn och max 31 tecken. */
const sheetName = ( s ) => String( s ).replace( /[\\/?*[\]:]/g, ' ' ).slice( 0, 31 );

export function makeXlsx( sheets ) {
	const ns = 'http://schemas.openxmlformats.org/';
	const sheetXml = ( rows ) => {
		const widths = [];
		const body = rows
			.map( ( r, ri ) => {
				const cells = r
					.map( ( v, ci ) => {
						widths[ ci ] = Math.min( 60, Math.max( widths[ ci ] || 8, String( v ?? '' ).length + 2 ) );
						const ref = col( ci ) + ( ri + 1 );
						const style = ri === 0 ? ' s="1"' : '';
						if ( v === null || v === undefined || v === '' ) {
							return '';
						}
						if ( typeof v === 'number' && Number.isFinite( v ) ) {
							return `<c r="${ ref }"${ style }><v>${ v }</v></c>`;
						}
						return `<c r="${ ref }" t="inlineStr"${ style }><is><t xml:space="preserve">${ x( v ) }</t></is></c>`;
					} )
					.join( '' );
				return `<row r="${ ri + 1 }">${ cells }</row>`;
			} )
			.join( '' );
		const cols = widths.map( ( w, i ) => `<col min="${ i + 1 }" max="${ i + 1 }" width="${ w }" customWidth="1"/>` ).join( '' );
		const last = col( Math.max( 0, ( rows[ 0 ] || [] ).length - 1 ) ) + Math.max( 1, rows.length );
		return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ ns }spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${ cols ? `<cols>${ cols }</cols>` : '' }<sheetData>${ body }</sheetData>${ rows.length > 1 ? `<autoFilter ref="A1:${ last }"/>` : '' }</worksheet>`;
	};
	const names = [];
	sheets.forEach( ( s ) => {
		let n = sheetName( s.name );
		while ( names.includes( n ) ) {
			n = n.slice( 0, 28 ) + ' ' + names.length;
		}
		names.push( n );
	} );
	const files = [
		{ name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${ ns }package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${ sheets.map( ( s, i ) => `<Override PartName="/xl/worksheets/sheet${ i + 1 }.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` ).join( '' ) }</Types>` },
		{ name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ ns }package/2006/relationships"><Relationship Id="rId1" Type="${ ns }officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
		{ name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ ns }spreadsheetml/2006/main" xmlns:r="${ ns }officeDocument/2006/relationships"><sheets>${ names.map( ( n, i ) => `<sheet name="${ x( n ) }" sheetId="${ i + 1 }" r:id="rId${ i + 1 }"/>` ).join( '' ) }</sheets></workbook>` },
		{ name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ ns }package/2006/relationships">${ sheets.map( ( s, i ) => `<Relationship Id="rId${ i + 1 }" Type="${ ns }officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${ i + 1 }.xml"/>` ).join( '' ) }<Relationship Id="rId${ sheets.length + 1 }" Type="${ ns }officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
		{ name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${ ns }spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3EBDD"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
		...sheets.map( ( s, i ) => ( { name: `xl/worksheets/sheet${ i + 1 }.xml`, data: sheetXml( s.rows ) } ) ),
	];
	return zip( files );
}

export function download( blob, name ) {
	const url = URL.createObjectURL( blob );
	const a = document.createElement( 'a' );
	a.href = url;
	a.download = name;
	document.body.appendChild( a );
	a.click();
	a.remove();
	setTimeout( () => URL.revokeObjectURL( url ), 4000 );
}

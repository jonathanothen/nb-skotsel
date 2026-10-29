/**
 * Läser en xlsx-fil i webbläsaren: packar upp zip-filen (DecompressionStream) och tolkar bladen.
 * Returnerar { bladnamn: [[cell, cell, …], …] } med text och tal. Klarar både delade strängar
 * (som Excel sparar) och inbäddade strängar (som appens egen export).
 */

async function inflate( bytes ) {
	const out = new Blob( [ bytes ] ).stream().pipeThrough( new DecompressionStream( 'deflate-raw' ) );
	return new Uint8Array( await new Response( out ).arrayBuffer() );
}

async function unzip( buf ) {
	const b = new Uint8Array( buf );
	const dv = new DataView( buf );
	let eocd = -1;
	for ( let i = b.length - 22; i >= Math.max( 0, b.length - 66000 ); i-- ) {
		if ( dv.getUint32( i, true ) === 0x06054b50 ) {
			eocd = i;
			break;
		}
	}
	if ( eocd < 0 ) {
		throw new Error( 'Filen är ingen giltig Excel-fil (xlsx).' );
	}
	const files = {};
	const dec = new TextDecoder();
	let p = dv.getUint32( eocd + 16, true );
	for ( let n = dv.getUint16( eocd + 10, true ); n > 0; n-- ) {
		const method = dv.getUint16( p + 10, true );
		const size = dv.getUint32( p + 20, true );
		const nameLen = dv.getUint16( p + 28, true );
		const extra = dv.getUint16( p + 30, true );
		const comment = dv.getUint16( p + 32, true );
		const local = dv.getUint32( p + 42, true );
		const name = dec.decode( b.subarray( p + 46, p + 46 + nameLen ) );
		const start = local + 30 + dv.getUint16( local + 26, true ) + dv.getUint16( local + 28, true );
		const data = b.subarray( start, start + size );
		files[ name ] = () => ( method === 8 ? inflate( data ) : Promise.resolve( data ) ).then( ( x ) => dec.decode( x ) );
		p += 46 + nameLen + extra + comment;
	}
	return files;
}

const xml = ( s ) => new DOMParser().parseFromString( s, 'application/xml' );
const colIndex = ( ref ) => {
	let n = 0;
	for ( const ch of ref.replace( /\d+$/, '' ) ) {
		n = n * 26 + ( ch.charCodeAt( 0 ) - 64 );
	}
	return n - 1;
};

export async function readXlsx( file ) {
	if ( typeof DecompressionStream === 'undefined' ) {
		throw new Error( 'Webbläsaren kan inte läsa Excel-filer. Använd en nyare webbläsare eller JSON.' );
	}
	const files = await unzip( await file.arrayBuffer() );
	if ( ! files[ 'xl/workbook.xml' ] ) {
		throw new Error( 'Filen är ingen Excel-arbetsbok.' );
	}
	const shared = files[ 'xl/sharedStrings.xml' ] ? [ ...xml( await files[ 'xl/sharedStrings.xml' ]() ).getElementsByTagName( 'si' ) ].map( ( si ) => [ ...si.getElementsByTagName( 't' ) ].map( ( t ) => t.textContent ).join( '' ) ) : [];
	const rels = {};
	[ ...xml( await files[ 'xl/_rels/workbook.xml.rels' ]() ).getElementsByTagName( 'Relationship' ) ].forEach( ( r ) => ( rels[ r.getAttribute( 'Id' ) ] = r.getAttribute( 'Target' ).replace( /^\/?(xl\/)?/, 'xl/' ) ) );
	const out = {};
	for ( const s of xml( await files[ 'xl/workbook.xml' ]() ).getElementsByTagName( 'sheet' ) ) {
		const rid = s.getAttribute( 'r:id' ) || s.getAttributeNS( 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id' );
		const path = rels[ rid ];
		if ( ! path || ! files[ path ] ) {
			continue;
		}
		const rows = [];
		for ( const row of xml( await files[ path ]() ).getElementsByTagName( 'row' ) ) {
			const r = [];
			for ( const c of row.getElementsByTagName( 'c' ) ) {
				const t = c.getAttribute( 't' );
				const v = c.getElementsByTagName( 'v' )[ 0 ];
				let val = null;
				if ( t === 's' ) {
					val = shared[ Number( v && v.textContent ) ] ?? '';
				} else if ( t === 'inlineStr' ) {
					val = [ ...c.getElementsByTagName( 't' ) ].map( ( x ) => x.textContent ).join( '' );
				} else if ( t === 'str' || t === 'e' ) {
					val = v ? v.textContent : '';
				} else if ( t === 'b' ) {
					val = v && v.textContent === '1' ? 1 : 0;
				} else if ( v ) {
					val = Number( v.textContent );
				}
				r[ colIndex( c.getAttribute( 'r' ) ) ] = val;
			}
			rows[ Number( row.getAttribute( 'r' ) ) - 1 ] = r;
		}
		out[ s.getAttribute( 'name' ) ] = rows.map( ( r ) => r || [] );
	}
	return out;
}

/**
 * Excel i databasformat (ett blad per tabell, första raden kolumnnamn) → samma struktur som
 * JSON-exporten. Tomma celler utelämnas så att kolumnens standardvärde gäller.
 */
export function sheetsToData( sheets ) {
	const data = {};
	Object.entries( sheets ).forEach( ( [ name, rows ] ) => {
		if ( ! rows.length || name === 'Om filen' ) {
			return;
		}
		const head = rows[ 0 ].map( ( h ) => String( h ?? '' ).trim() );
		data[ name ] = rows.slice( 1 ).filter( ( r ) => r.some( ( v ) => v !== null && v !== undefined && v !== '' ) ).map( ( r ) => {
			const o = {};
			head.forEach( ( h, i ) => {
				if ( h && r[ i ] !== null && r[ i ] !== undefined && r[ i ] !== '' ) {
					o[ h ] = r[ i ];
				}
			} );
			return o;
		} );
	} );
	return data;
}

/**
 * Läser platser ur en KML- eller KMZ-fil (t.ex. exporterad från Google My Maps eller
 * Google Earth). KMZ är en zip-fil; den packas upp i webbläsaren med DecompressionStream.
 * Returnerar [{ name, lat, lng, description }].
 */

async function inflate( bytes ) {
	const ds = new DecompressionStream( 'deflate-raw' );
	const out = new Blob( [ bytes ] ).stream().pipeThrough( ds );
	return new Uint8Array( await new Response( out ).arrayBuffer() );
}

/** Hämtar första .kml-filen ur en zip via centralkatalogen. */
async function kmlFromZip( buf ) {
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
		throw new Error( 'Filen är ingen giltig KMZ.' );
	}
	const count = dv.getUint16( eocd + 10, true );
	let p = dv.getUint32( eocd + 16, true );
	const dec = new TextDecoder();
	for ( let n = 0; n < count; n++ ) {
		const method = dv.getUint16( p + 10, true );
		const size = dv.getUint32( p + 20, true );
		const nameLen = dv.getUint16( p + 28, true );
		const extra = dv.getUint16( p + 30, true );
		const comment = dv.getUint16( p + 32, true );
		const local = dv.getUint32( p + 42, true );
		const name = dec.decode( b.subarray( p + 46, p + 46 + nameLen ) );
		if ( /\.kml$/i.test( name ) ) {
			const start = local + 30 + dv.getUint16( local + 26, true ) + dv.getUint16( local + 28, true );
			const data = b.subarray( start, start + size );
			return dec.decode( method === 8 ? await inflate( data ) : data );
		}
		p += 46 + nameLen + extra + comment;
	}
	throw new Error( 'Ingen KML-fil hittades i KMZ-filen.' );
}

export async function readPlaces( file ) {
	const buf = await file.arrayBuffer();
	const head = new Uint8Array( buf.slice( 0, 2 ) );
	const isZip = head[ 0 ] === 0x50 && head[ 1 ] === 0x4b;
	if ( isZip && typeof DecompressionStream === 'undefined' ) {
		throw new Error( 'Webbläsaren kan inte packa upp KMZ. Exportera som KML i stället.' );
	}
	const text = isZip ? await kmlFromZip( buf ) : new TextDecoder().decode( buf );
	const doc = new DOMParser().parseFromString( text, 'application/xml' );
	if ( doc.getElementsByTagName( 'parsererror' ).length ) {
		throw new Error( 'KML-filen kunde inte läsas.' );
	}
	const places = [];
	Array.from( doc.getElementsByTagName( 'Placemark' ) ).forEach( ( pm ) => {
		const coords = pm.getElementsByTagName( 'coordinates' )[ 0 ];
		const nameEl = Array.from( pm.children ).find( ( c ) => c.localName === 'name' );
		const descEl = Array.from( pm.children ).find( ( c ) => c.localName === 'description' );
		if ( ! coords ) {
			return;
		}
		// Punkt: "lng,lat,alt". För linjer/ytor används första punkten.
		const [ lng, lat ] = coords.textContent.trim().split( /\s+/ )[ 0 ].split( ',' ).map( Number );
		if ( ! Number.isFinite( lat ) || ! Number.isFinite( lng ) ) {
			return;
		}
		const tmp = document.createElement( 'div' );
		tmp.innerHTML = descEl ? descEl.textContent : '';
		places.push( {
			name: ( nameEl ? nameEl.textContent : 'Plats' ).trim(),
			lat: +lat.toFixed( 6 ),
			lng: +lng.toFixed( 6 ),
			description: ( tmp.textContent || '' ).replace( /\s+/g, ' ' ).trim(),
		} );
	} );
	return places;
}

const norm = ( s ) => String( s || '' ).toLowerCase().replace( /\s+/g, ' ' ).trim();

/**
 * Föreslår vilken bigård varje plats hör till: exakt namn, annars att det ena namnet
 * börjar med det andra (Parningsplats → Parningsplatsen, Österbo → Österbo vid gården).
 * Flera platser med samma namn (Fågelsta) fördelas på olika bigårdar söderifrån.
 */
export function matchPlaces( places, apiaries ) {
	const used = new Set();
	const order = places.map( ( p, i ) => i ).sort( ( a, b ) => places[ a ].lat - places[ b ].lat );
	const result = places.map( () => '' );
	const pass = ( test ) =>
		order.forEach( ( i ) => {
			if ( result[ i ] ) {
				return;
			}
			const n = norm( places[ i ].name );
			const hits = apiaries.filter( ( a ) => ! used.has( a.id ) && test( norm( a.name ), n ) );
			// Söderifrån: "syd" före "nord" när namnen är lika.
			hits.sort( ( a, b ) => /syd|södra/.test( norm( b.name ) ) - /syd|södra/.test( norm( a.name ) ) || a.name.localeCompare( b.name, 'sv' ) );
			if ( hits[ 0 ] ) {
				result[ i ] = hits[ 0 ].id;
				used.add( hits[ 0 ].id );
			}
		} );
	pass( ( a, n ) => a === n );
	pass( ( a, n ) => a.startsWith( n ) || n.startsWith( a ) );
	pass( ( a, n ) => a.includes( n ) || n.includes( a ) );
	return result;
}

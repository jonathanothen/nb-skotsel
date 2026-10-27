/**
 * Positioner och kartlänkar: läser koordinater ur inklistrade Google/Apple-länkar,
 * bygger länkar till Google Maps och Apple Kartor (samma upplägg som Tämnarrundans
 * "Min rutt") och hämtar körtider från OSRM.
 */

const valid = ( lat, lng ) => Number.isFinite( lat ) && Number.isFinite( lng ) && Math.abs( lat ) <= 90 && Math.abs( lng ) <= 180 && ! ( lat === 0 && lng === 0 );

/** "60.12, 17.25", "60,12 17,25" eller en Google/Apple-länk → { lat, lng } eller null. */
export function parseCoords( input ) {
	const s = decodeURIComponent( String( input || '' ).trim() );
	if ( ! s ) {
		return null;
	}
	const patterns = [
		/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, // Google: platsens exakta punkt
		/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/, // Google: kartans mittpunkt
		/[?&](?:q|query|ll|sll|daddr|destination|center|coordinate)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
		/^(-?\d+\.\d+)\s*[,;\s]\s*(-?\d+\.\d+)$/, // 60.12, 17.25
		/^(-?\d+,\d+)\s+(-?\d+,\d+)$/, // 60,12 17,25
		/^(-?\d+,\d+)\s*;\s*(-?\d+,\d+)$/,
	];
	for ( const re of patterns ) {
		const m = s.match( re );
		if ( m ) {
			const lat = parseFloat( m[ 1 ].replace( ',', '.' ) );
			const lng = parseFloat( m[ 2 ].replace( ',', '.' ) );
			if ( valid( lat, lng ) ) {
				return { lat: +lat.toFixed( 6 ), lng: +lng.toFixed( 6 ) };
			}
		}
	}
	return null;
}

/** Kortlänkar (maps.app.goo.gl) måste följas på servern för att få fram koordinaterna. */
export const isShortLink = ( s ) => /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test( String( s || '' ).trim() );

const pt = ( p ) => `${ p.lat },${ p.lng }`;

export const googlePlace = ( p ) => `https://www.google.com/maps/search/?api=1&query=${ encodeURIComponent( pt( p ) ) }`;
export const googleTo = ( p ) => `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${ encodeURIComponent( pt( p ) ) }`;
export const appleTo = ( p, name ) => `https://maps.apple.com/?dirflg=d&daddr=${ encodeURIComponent( pt( p ) ) }${ name ? '&q=' + encodeURIComponent( name ) : '' }`;

/** Google tillåter högst 9 mellanstopp i en länk: 11 punkter per del. */
export const GOOGLE_MAX = 11;

/** Google Maps-rutt genom alla punkter (första = start, sista = mål). */
export function googleRoute( points ) {
	if ( ! points.length ) {
		return '';
	}
	const s = points.map( pt );
	let url = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent( s[ s.length - 1 ] );
	if ( s.length > 1 ) {
		url += '&origin=' + encodeURIComponent( s[ 0 ] );
	}
	if ( s.length > 2 ) {
		url += '&waypoints=' + encodeURIComponent( s.slice( 1, -1 ).join( '|' ) );
	}
	return url;
}

/** Delar upp en lång rutt i Google-länkar; varje del börjar där den förra slutade. */
export function googleParts( points ) {
	if ( points.length <= GOOGLE_MAX ) {
		return [ { from: 0, to: points.length - 1, url: googleRoute( points ) } ];
	}
	const parts = [];
	for ( let i = 0; i < points.length - 1; i += GOOGLE_MAX - 1 ) {
		const end = Math.min( i + GOOGLE_MAX - 1, points.length - 1 );
		parts.push( { from: i, to: end, url: googleRoute( points.slice( i, end + 1 ) ) } );
	}
	return parts;
}

/** Apple Kartor: start som saddr och varje stopp som en egen daddr (flera stopp från iOS 16). */
export function appleRoute( points ) {
	if ( ! points.length ) {
		return '';
	}
	let url = 'https://maps.apple.com/?dirflg=d';
	let dest = points;
	if ( points.length > 1 ) {
		url += '&saddr=' + encodeURIComponent( pt( points[ 0 ] ) );
		dest = points.slice( 1 );
	}
	dest.forEach( ( p ) => ( url += '&daddr=' + encodeURIComponent( pt( p ) ) ) );
	return url;
}

/** Fågelvägen i meter. */
export function distance( a, b ) {
	const R = 6371000;
	const r = Math.PI / 180;
	const dLat = ( b.lat - a.lat ) * r;
	const dLng = ( b.lng - a.lng ) * r;
	const h = Math.sin( dLat / 2 ) ** 2 + Math.cos( a.lat * r ) * Math.cos( b.lat * r ) * Math.sin( dLng / 2 ) ** 2;
	return 2 * R * Math.asin( Math.sqrt( h ) );
}

/* ------------------------------------------------------------------ OSRM */

const SERVERS = [ 'https://router.project-osrm.org', 'https://routing.openstreetmap.de/routed-car' ];
const lnglat = ( points ) => points.map( ( p ) => `${ p.lng },${ p.lat }` ).join( ';' );

async function osrm( path ) {
	let last;
	for ( const base of SERVERS ) {
		try {
			const r = await fetch( base + path );
			const d = await r.json();
			if ( d && d.code === 'Ok' ) {
				return d;
			}
			last = new Error( d && d.message );
		} catch ( e ) {
			last = e;
		}
	}
	throw last || new Error( 'Ingen rutt' );
}

const cache = {};

/** Körväg genom punkterna: { legs: [{duration, distance}], geom: [[lat,lng]…], duration, distance }. */
export async function route( points ) {
	const key = lnglat( points );
	if ( cache[ key ] ) {
		return cache[ key ];
	}
	const d = await osrm( `/route/v1/driving/${ key }?overview=full&geometries=geojson` );
	const r0 = d.routes[ 0 ];
	return ( cache[ key ] = {
		legs: r0.legs.map( ( l ) => ( { duration: l.duration, distance: l.distance } ) ),
		geom: r0.geometry.coordinates.map( ( c ) => [ c[ 1 ], c[ 0 ] ] ),
		duration: r0.duration,
		distance: r0.distance,
	} );
}

/** Körtider mellan alla punkter (sekunder), för att optimera ordningen. */
export async function durationTable( points ) {
	const d = await osrm( `/table/v1/driving/${ lnglat( points ) }?annotations=duration` );
	return d.durations;
}

/**
 * Bästa ordning för stoppen mellan en fast start och ett fast mål: närmaste granne
 * följt av 2-opt. cost(i, j) ger kostnaden mellan punkt i och j; punkt 0 är start,
 * sista punkten är mål, däremellan stoppen. Returnerar stoppens index i ny ordning.
 */
export function optimizeOrder( n, cost, hasEnd ) {
	const stops = [];
	for ( let i = 1; i <= n; i++ ) {
		stops.push( i );
	}
	// Närmaste granne från start.
	const order = [];
	let cur = 0;
	const left = new Set( stops );
	while ( left.size ) {
		let best = null;
		left.forEach( ( s ) => {
			if ( best === null || cost( cur, s ) < cost( cur, best ) ) {
				best = s;
			}
		} );
		order.push( best );
		left.delete( best );
		cur = best;
	}
	// 2-opt: vänd delsträckor så länge det blir kortare.
	const endIdx = hasEnd ? n + 1 : null;
	const total = ( o ) => {
		let s = cost( 0, o[ 0 ] );
		for ( let i = 1; i < o.length; i++ ) {
			s += cost( o[ i - 1 ], o[ i ] );
		}
		return s + ( endIdx !== null ? cost( o[ o.length - 1 ], endIdx ) : 0 );
	};
	let best = total( order );
	let improved = true;
	let guard = 0;
	while ( improved && guard++ < 200 ) {
		improved = false;
		for ( let i = 0; i < order.length - 1; i++ ) {
			for ( let k = i + 1; k < order.length; k++ ) {
				const next = [ ...order.slice( 0, i ), ...order.slice( i, k + 1 ).reverse(), ...order.slice( k + 1 ) ];
				const t = total( next );
				if ( t + 1e-9 < best ) {
					order.splice( 0, order.length, ...next );
					best = t;
					improved = true;
				}
			}
		}
	}
	return order;
}

export const fmtKm = ( m ) => `${ ( m / 1000 ).toLocaleString( 'sv-SE', { maximumFractionDigits: m < 10000 ? 1 : 0 } ) } km`;
export function fmtDuration( sec ) {
	const min = Math.round( sec / 60 );
	const h = Math.floor( min / 60 );
	return h ? `${ h } h ${ min % 60 } min` : `${ min } min`;
}

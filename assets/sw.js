/* Tjänstearbetare för Skötsel-appen: gör appen användbar utan täckning i bigården.
 * - Appens filer (JS/CSS) och WordPress-biblioteken: sparas och uppdateras i bakgrunden.
 * - Sidan /skotsel/: hämtas från nätet, annars den sparade versionen.
 * - Läsningar från API:t (GET): nätet först, annars senast sparade svar.
 * Skrivningar (POST/PUT/DELETE) går alltid till nätet; besök sparas i telefonen tills de går igenom.
 */
const VERSION = 'nbs-__VERSION__';
const BASE = '__BASE__';
const PLUGIN = '__PLUGIN__';

self.addEventListener( 'install', () => self.skipWaiting() );
self.addEventListener( 'activate', ( e ) => {
	e.waitUntil(
		caches.keys().then( ( keys ) => Promise.all( keys.filter( ( k ) => k.startsWith( 'nbs-' ) && k !== VERSION ).map( ( k ) => caches.delete( k ) ) ) ).then( () => self.clients.claim() )
	);
} );

// Utloggning: appen skickar 'clear' så att inget sparat ligger kvar i telefonen.
self.addEventListener( 'message', ( e ) => {
	if ( e.data === 'clear' ) {
		caches.keys().then( ( keys ) => keys.filter( ( k ) => k.startsWith( 'nbs-' ) ).forEach( ( k ) => caches.delete( k ) ) );
	}
} );

const networkFirst = async ( req, fallbackUrl ) => {
	const cache = await caches.open( VERSION );
	try {
		const res = await fetch( req );
		if ( res.ok ) {
			cache.put( fallbackUrl || req, res.clone() );
		}
		return res;
	} catch ( err ) {
		const hit = await cache.match( fallbackUrl || req );
		if ( hit ) {
			return hit;
		}
		if ( req.url.includes( '/wp-json/' ) ) {
			return new Response( JSON.stringify( { code: 'offline', message: 'Ingen uppkoppling, och uppgiften finns inte sparad i telefonen.' } ), { status: 503, headers: { 'Content-Type': 'application/json' } } );
		}
		throw err;
	}
};

const staleWhileRevalidate = async ( req ) => {
	const cache = await caches.open( VERSION );
	const hit = await cache.match( req );
	const net = fetch( req ).then( ( res ) => {
		if ( res.ok ) {
			cache.put( req, res.clone() );
		}
		return res;
	} ).catch( () => hit );
	return hit || net;
};

self.addEventListener( 'fetch', ( e ) => {
	const req = e.request;
	if ( req.method !== 'GET' ) {
		return;
	}
	const url = new URL( req.url );
	if ( url.origin !== self.location.origin ) {
		return;
	}
	if ( url.pathname.includes( '/wp-json/nbs/v1/' ) ) {
		e.respondWith( networkFirst( req ) );
	} else if ( url.pathname.startsWith( PLUGIN ) || url.pathname.includes( '/wp-includes/js/' ) || url.pathname.includes( '/wp-includes/css/' ) ) {
		e.respondWith( staleWhileRevalidate( req ) );
	} else if ( req.mode === 'navigate' && url.pathname.startsWith( BASE ) ) {
		e.respondWith( networkFirst( req, BASE ) );
	}
} );

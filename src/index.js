import { createRoot } from '@wordpress/element';
import App from './App';
import './style.scss';

const el = document.getElementById( 'nbs-root' );
if ( el ) {
	createRoot( el ).render( <App /> );
}

// Offlinestöd på /skotsel/ (inte i WP-admin): tjänstearbetaren ligger på /skotsel/sw.js.
const cfg = window.NBS || {};
if ( 'serviceWorker' in navigator && cfg.base && cfg.base !== 'admin' ) {
	window.addEventListener( 'load', () => {
		navigator.serviceWorker.register( cfg.base.replace( /\/?$/, '/' ) + 'sw.js', { scope: cfg.base.replace( /\/?$/, '/' ) } ).catch( () => {} );
	} );
}

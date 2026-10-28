import { createContext, useContext, useEffect, useState } from '@wordpress/element';
import { api, config } from './api';
import { useRoute, href } from './router';
import { ToastProvider, useLoad, Loading, ErrorBox } from './ui';
import Overview from './views/Overview';
import Lists from './views/Lists';
import Settings from './views/Settings';
import Apiaries from './views/Apiaries';
import Colonies from './views/Colonies';
import Queens from './views/Queens';
import Stock from './views/Stock';
import Visits from './views/Visits';
import Plan from './views/Plan';
import Health from './views/Health';
import Honey from './views/Honey';
import Breeding from './views/Breeding';
import Economy from './views/Economy';
import { RegisterProvider, useRegister } from './register';

export const MeCtx = createContext( null );
export const useMe = () => useContext( MeCtx );

/**
 * Moduler i menyn. På mobilen syns bara de med mobile: true i menyraden; resten nås via
 * "Mer" (mobileOnly). Ordningen följer arbetet: det man gör ofta först.
 */
export const MODULES = [
	{ key: '', label: 'Översikt', short: 'Hem', icon: '◎', mobile: true },
	{ key: 'besok', label: 'Besök', icon: '✓', mobile: true },
	{ key: 'driftplan', label: 'Driftplan', icon: '▦' },
	{ key: 'bigardar', label: 'Bigårdar', icon: '⌂', mobile: true },
	{ key: 'samhallen', label: 'Samhällen', icon: '⬡', mobile: true },
	{ key: 'drottningar', label: 'Drottningar', icon: '♛' },
	{ key: 'bihalsa', label: 'Bihälsa', icon: '✚' },
	{ key: 'honung', label: 'Honung', icon: '◈' },
	{ key: 'avel', label: 'Avel', icon: '❀' },
	{ key: 'lager', label: 'Lager', icon: '▤', mobile: true },
	{ key: 'ekonomi', label: 'Ekonomi', icon: '◷' },
	{ key: 'listor', label: 'Listor', icon: '☰' },
	{ key: 'installningar', label: 'Inställningar', icon: '⚙' },
	{ key: 'mer', label: 'Mer', icon: '⋯', mobile: true, mobileOnly: true },
];

/** Mobilens "Mer": alla moduler som inte ryms i menyraden. */
function More() {
	return (
		<div className="nbs-page">
			<h1 className="nbs-h1">Mer</h1>
			<div className="nbs-more-grid">
				{ MODULES.filter( ( m ) => ! m.mobile && ! m.mobileOnly ).map( ( m ) => (
					<a key={ m.key } className="nbs-more-tile" href={ href( m.key ) }>
						<span aria-hidden="true">{ m.icon }</span>
						{ m.label }
					</a>
				) ) }
			</div>
		</div>
	);
}

/** #/kupa/<id> (QR-koden på kupan): öppnar samhället som står i kupan. */
function HiveLink( { id } ) {
	const reg = useRegister();
	useEffect( () => {
		if ( reg.loading ) {
			return;
		}
		const c = reg.activeColonies.find( ( x ) => x.hive_id === id );
		window.location.replace( '#/' + ( c ? 'samhallen/' + c.id : 'samhallen/kupor' ) );
	}, [ reg.loading ] ); // eslint-disable-line react-hooks/exhaustive-deps
	return <Loading />;
}

/** Visar en rad när telefonen saknar uppkoppling. */
function OfflineBar() {
	const [ online, setOnline ] = useState( navigator.onLine );
	useEffect( () => {
		const on = () => setOnline( true );
		const off = () => setOnline( false );
		window.addEventListener( 'online', on );
		window.addEventListener( 'offline', off );
		return () => {
			window.removeEventListener( 'online', on );
			window.removeEventListener( 'offline', off );
		};
	}, [] );
	return online ? null : <div className="nbs-offline" role="status">Ingen uppkoppling – du ser sparade uppgifter. Besök sparas i telefonen och skickas när täckningen är tillbaka.</div>;
}

/** Utloggning: töm det som sparats för offlinebruk innan sessionen avslutas. */
function logout( e ) {
	e.preventDefault();
	const go = () => ( window.location.href = config.logout );
	try {
		Object.keys( localStorage ).filter( ( k ) => k.startsWith( 'nbs_visit_draft_' ) ).forEach( ( k ) => localStorage.removeItem( k ) );
	} catch ( err ) {
		/* privat läge */
	}
	if ( window.caches ) {
		caches.keys().then( ( keys ) => Promise.all( keys.filter( ( k ) => k.startsWith( 'nbs-' ) ).map( ( k ) => caches.delete( k ) ) ) ).then( go, go );
	} else {
		go();
	}
}

function Shell() {
	const route = useRoute();
	const [ me, error ] = useLoad( () => api( 'me' ) );
	if ( error ) {
		return <div className="nbs-page"><ErrorBox error={ error } /></div>;
	}
	if ( ! me ) {
		return <Loading />;
	}
	const key = route[ 0 ] || '';
	const current = MODULES.find( ( m ) => m.key === key ) || MODULES[ 0 ];
	const rest = route.slice( 1 );
	const pages = {
		bigardar: () => <Apiaries id={ route[ 1 ] } sub={ route[ 2 ] } />,
		samhallen: () => <Colonies id={ route[ 1 ] } />,
		besok: () => <Visits route={ rest } />,
		driftplan: () => <Plan route={ rest } />,
		lager: () => <Stock route={ rest } />,
		drottningar: () => <Queens id={ route[ 1 ] } />,
		bihalsa: () => <Health route={ rest } />,
		honung: () => <Honey route={ rest } />,
		avel: () => <Breeding route={ rest } />,
		ekonomi: () => <Economy route={ rest } />,
		listor: () => <Lists listId={ route[ 1 ] } />,
		installningar: () => <Settings tab={ route[ 1 ] } />,
		mer: () => <More />,
	};
	const page = key === 'kupa' && route[ 1 ] ? <HiveLink id={ route[ 1 ] } /> : pages[ current.key ] ? pages[ current.key ]() : <Overview />;
	// "Mer" är markerad på mobilen när man är i en modul som inte syns i menyraden.
	const activeMobile = current.mobile ? current : MODULES.find( ( m ) => m.key === 'mer' );
	return (
		<MeCtx.Provider value={ me }>
			<RegisterProvider>
				<div className={ `nbs-app${ config.base === 'admin' ? ' is-admin' : '' }` }>
					<header className="nbs-top">
						<a className="nbs-brand" href={ href( '' ) }>
							<span className="nbs-brand-mark" aria-hidden="true">⬡</span>
							<span><strong>Skötsel</strong><small>{ me.org ? me.org.name : '' }</small></span>
						</a>
						<div className="nbs-top-right">
							<span className="nbs-user">{ me.user.name }</span>
							{ config.base !== 'admin' && <a className="nbs-top-link" href={ config.home }>Till webbplatsen</a> }
							{ config.base !== 'admin' && <a className="nbs-top-link" href={ config.logout } onClick={ logout }>Logga ut</a> }
						</div>
					</header>
					<nav className="nbs-nav" aria-label="Huvudmeny">
						{ MODULES.map( ( m ) => {
							const active = m === current;
							const cls = [ 'nbs-nav-item', active && 'is-active', m === activeMobile && 'is-active-mobile', ! m.mobile && 'is-desktop-only', m.mobileOnly && 'is-mobile-only' ].filter( Boolean ).join( ' ' );
							return (
								<a key={ m.key || 'home' } href={ href( m.key ) } className={ cls } aria-current={ active ? 'page' : undefined } aria-label={ m.label }>
									<span className="nbs-nav-icon" aria-hidden="true">{ m.icon }</span>
									<span className="nbs-nav-label">{ m.label }</span>
									<span className="nbs-nav-short" aria-hidden="true">{ m.short || m.label }</span>
								</a>
							);
						} ) }
					</nav>
					<main className="nbs-main">
						<OfflineBar />
						{ page }
					</main>
				</div>
			</RegisterProvider>
		</MeCtx.Provider>
	);
}

export default function App() {
	return (
		<ToastProvider>
			<Shell />
		</ToastProvider>
	);
}

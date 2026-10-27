import { createContext, useContext } from '@wordpress/element';
import { api, config } from './api';
import { useRoute, href } from './router';
import { ToastProvider, useLoad, Loading, ErrorBox } from './ui';
import Overview from './views/Overview';
import Lists from './views/Lists';
import Settings from './views/Settings';

export const MeCtx = createContext( null );
export const useMe = () => useContext( MeCtx );

/** Moduler i menyn. De som inte är byggda än visas som "kommer". */
export const MODULES = [
	{ key: '', label: 'Översikt', icon: '◎' },
	{ key: 'bigardar', label: 'Bigårdar', icon: '⌂', phase: 1 },
	{ key: 'samhallen', label: 'Samhällen', icon: '⬡', phase: 1 },
	{ key: 'drottningar', label: 'Drottningar', icon: '♛', phase: 1 },
	{ key: 'lager', label: 'Lager', icon: '▤', phase: 2 },
	{ key: 'besok', label: 'Besök', icon: '✓', phase: 3 },
	{ key: 'driftplan', label: 'Driftplan', icon: '▦', phase: 4 },
	{ key: 'listor', label: 'Listor', icon: '☰' },
	{ key: 'installningar', label: 'Inställningar', icon: '⚙' },
];

function Coming( { mod } ) {
	return (
		<div className="nbs-page">
			<h1 className="nbs-h1">{ mod.label }</h1>
			<div className="nbs-empty">
				<h3>Kommer i fas { mod.phase }</h3>
				<p>Den här delen byggs enligt planen. Börja gärna med att fylla i dina listor, så finns material, kuptyper, linjer och foder på plats när modulen kommer.</p>
				<a className="nbs-btn is-primary" href={ href( 'listor' ) }>Till listorna</a>
			</div>
		</div>
	);
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
	const current = MODULES.find( ( m ) => m.key === ( route[ 0 ] || '' ) ) || MODULES[ 0 ];
	let page;
	if ( current.key === 'listor' ) {
		page = <Lists listId={ route[ 1 ] } />;
	} else if ( current.key === 'installningar' ) {
		page = <Settings tab={ route[ 1 ] } />;
	} else if ( current.phase ) {
		page = <Coming mod={ current } />;
	} else {
		page = <Overview />;
	}
	return (
		<MeCtx.Provider value={ me }>
			<div className={ `nbs-app${ config.base === 'admin' ? ' is-admin' : '' }` }>
				<header className="nbs-top">
					<a className="nbs-brand" href={ href( '' ) }>
						<span className="nbs-brand-mark" aria-hidden="true">⬡</span>
						<span><strong>Skötsel</strong><small>{ me.org ? me.org.name : '' }</small></span>
					</a>
					<div className="nbs-top-right">
						<span className="nbs-user">{ me.user.name }</span>
						{ config.base !== 'admin' && <a className="nbs-top-link" href={ config.home }>Till webbplatsen</a> }
						{ config.base !== 'admin' && <a className="nbs-top-link" href={ config.logout }>Logga ut</a> }
					</div>
				</header>
				<nav className="nbs-nav" aria-label="Huvudmeny">
					{ MODULES.map( ( m ) => (
						<a key={ m.key || 'home' } href={ href( m.key ) } className={ `nbs-nav-item${ m === current ? ' is-active' : '' }${ m.phase ? ' is-coming' : '' }` } aria-current={ m === current ? 'page' : undefined }>
							<span className="nbs-nav-icon" aria-hidden="true">{ m.icon }</span>
							<span className="nbs-nav-label">{ m.label }</span>
						</a>
					) ) }
				</nav>
				<main className="nbs-main">{ page }</main>
			</div>
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

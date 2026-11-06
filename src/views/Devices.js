import { useState } from '@wordpress/element';
import { api } from '../api';
import { href, go } from '../router';
import { useMe } from '../App';
import { useRegister } from '../register';
import { useLoad, Loading, ErrorBox, Button, Modal, Empty, useToast } from '../ui';

const kg = ( g ) => ( g === null || g === undefined ? '–' : ( g / 1000 ).toLocaleString( 'sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 } ) + ' kg' );
const deg = ( v ) => ( v === null || v === undefined ? '–' : v.toLocaleString( 'sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 } ) + ' °C' );
const when = ( iso ) => {
	if ( ! iso ) {
		return 'aldrig';
	}
	const mins = Math.round( ( Date.now() - new Date( iso ).getTime() ) / 60000 );
	if ( mins < 2 ) {
		return 'nyss';
	}
	if ( mins < 90 ) {
		return `${ mins } min sedan`;
	}
	if ( mins < 2 * 1440 ) {
		return `${ Math.round( mins / 60 ) } tim sedan`;
	}
	return new Date( iso ).toLocaleDateString( 'sv-SE' );
};
const signed = ( g ) => ( g === null || g === undefined ? '–' : ( g > 0 ? '+' : g < 0 ? '−' : '' ) + ( Math.abs( g ) / 1000 ).toLocaleString( 'sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 } ) + ' kg' );

export default function Devices( { route } ) {
	return route[ 0 ] ? <Detail key={ route[ 0 ] } id={ route[ 0 ] } /> : <List />;
}

/* -------------------------------------------------------------------- Lista */

function List() {
	const me = useMe();
	const toast = useToast();
	const reg = useRegister();
	const [ devices, error, reload ] = useLoad( () => api( 'devices' ) );
	const [ adding, setAdding ] = useState( false );
	const [ busy, setBusy ] = useState( false );
	if ( error ) {
		return <div className="nbs-page"><ErrorBox error={ error } /></div>;
	}
	if ( ! devices ) {
		return <Loading />;
	}
	const hiveLabel = ( id ) => ( reg.hives.find( ( h ) => h.id === id ) || {} ).label;
	const hasDemo = devices.some( ( d ) => d.dummy );
	const demo = async ( create ) => {
		setBusy( true );
		try {
			await api( 'devices/demo', { method: create ? 'POST' : 'DELETE' } );
			toast( create ? 'Demovågar skapade.' : 'Demovågar borttagna.' );
			reload();
		} catch ( e ) {
			toast( e.message, 'error' );
		}
		setBusy( false );
	};
	return (
		<div className="nbs-page">
			<header className="nbs-page-head">
				<div>
					<h1 className="nbs-h1">Vågar</h1>
					<p className="nbs-muted">Kupvågar som skickar vikt, temperatur, fukt och ljud via mobilnätet.</p>
				</div>
				<div className="nbs-row-actions">
					{ me.can.manage && ( hasDemo
						? <Button variant="ghost" disabled={ busy } onClick={ () => demo( false ) }>Ta bort demovågar</Button>
						: <Button variant="ghost" disabled={ busy } onClick={ () => demo( true ) }>Skapa demovågar</Button> ) }
					{ me.can.write && <Button onClick={ () => setAdding( true ) }>Lägg till våg</Button> }
				</div>
			</header>
			{ devices.length === 0 ? (
				<Empty title="Inga vågar än">
					<p>Lägg till en våg med id och claim-kod från etiketten. Vill du bara se hur det ser ut kan du skapa demovågar med påhittade värden.</p>
				</Empty>
			) : (
				<div className="nbs-cards nbs-dev-cards">
					{ devices.map( ( d ) => (
						<a key={ d.id } className="nbs-card nbs-dev-card" href={ href( 'vagar/' + d.id ) }>
							<div className="nbs-dev-top">
								<strong>{ d.name || d.id }</strong>
								{ d.dummy && <span className="nbs-badge">Demo</span> }
								{ d.shared && <span className="nbs-badge">Delad med dig</span> }
							</div>
							<small className="nbs-muted">{ hiveLabel( d.hive_id ) ? 'Kupa ' + hiveLabel( d.hive_id ) : d.hive_id ? '' : 'Inte kopplad till en kupa' }</small>
							<div className="nbs-dev-weight">{ d.calibrated ? kg( d.latest && d.latest.w ) : 'Ej kalibrerad' }</div>
							<div className="nbs-dev-line">
								<span>24 tim: { signed( d.trend_24h_g ) }</span>
								<span>Inne { deg( d.latest && d.latest.ti ) }</span>
								<span>Ute { deg( d.latest && d.latest.to ) }</span>
							</div>
							<div className="nbs-dev-line nbs-muted">
								<span>Batteri { d.battery_v ? d.battery_v.toLocaleString( 'sv-SE', { minimumFractionDigits: 2 } ) + ' V' : '–' }</span>
								<span>{ when( d.last_seen ) }</span>
							</div>
							{ d.alerts.map( ( a, i ) => <div key={ i } className="nbs-dev-alert">{ a.text }</div> ) }
						</a>
					) ) }
				</div>
			) }
			{ adding && <ClaimModal onClose={ () => setAdding( false ) } onDone={ ( d ) => { setAdding( false ); go( 'vagar/' + d.id ); } } /> }
		</div>
	);
}

function ClaimModal( { onClose, onDone } ) {
	const toast = useToast();
	const [ id, setId ] = useState( '' );
	const [ code, setCode ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const submit = async () => {
		setBusy( true );
		try {
			onDone( await api( 'devices/claim', { method: 'POST', body: { device_id: id, claim_code: code } } ) );
		} catch ( e ) {
			toast( e.message, 'error' );
			setBusy( false );
		}
	};
	return (
		<Modal title="Lägg till våg" onClose={ onClose } footer={ <><Button variant="ghost" onClick={ onClose }>Avbryt</Button><Button disabled={ busy || ! id || ! code } onClick={ submit }>Lägg till</Button></> }>
			<div className="nbs-field">
				<label htmlFor="nbs-dev-id">Id på etiketten</label>
				<input id="nbs-dev-id" type="text" placeholder="KV-XXXX-XXXX-XXXX" value={ id } onChange={ ( e ) => setId( e.target.value ) } />
			</div>
			<div className="nbs-field">
				<label htmlFor="nbs-dev-code">Claim-kod</label>
				<input id="nbs-dev-code" type="text" placeholder="XXXX-XXXX-XXXX" value={ code } onChange={ ( e ) => setCode( e.target.value ) } />
				<small className="nbs-help">Koden används en gång. Efter att vågen kopplats till dig går den inte att använda igen.</small>
			</div>
		</Modal>
	);
}

/* ------------------------------------------------------------------ Detalj */

const RANGES = [ [ 2, '2 dygn' ], [ 7, '7 dygn' ], [ 30, '30 dygn' ], [ 90, '90 dygn' ] ];
const CHARTS = [
	[ 'w', 'Vikt', [ { key: 'w', label: 'Vikt (kg)', color: '#A8741A', scale: 0.001 } ] ],
	[ 'temp', 'Temperatur', [ { key: 'ti', label: 'Inne i kupan (°C)', color: '#B4382E' }, { key: 'to', label: 'Ute (°C)', color: '#4A6B8A' } ] ],
	[ 'rh', 'Fukt', [ { key: 'rh', label: 'Fukt inne (%)', color: '#4A5640' } ] ],
	[ 'snd', 'Ljud', [ { key: 'snd', label: 'Ljudnivå (relativ)', color: '#6B4C8A' } ] ],
];

function Detail( { id } ) {
	const me = useMe();
	const reg = useRegister();
	const toast = useToast();
	const [ days, setDays ] = useState( 7 );
	const [ chart, setChart ] = useState( 'w' );
	const [ modal, setModal ] = useState( null );
	const [ dev, error, reload, setDev ] = useLoad( () => api( 'devices/' + id ), [ id ] );
	const [ data, , , ] = useLoad( () => api( `devices/${ id }/readings?from=${ encodeURIComponent( new Date( Date.now() - days * 86400000 ).toISOString() ) }` ), [ id, days, dev && dev.last_seen ] );
	if ( error ) {
		return <div className="nbs-page"><ErrorBox error={ error } /></div>;
	}
	if ( ! dev ) {
		return <Loading />;
	}
	const own = ! dev.shared && me.can.write;
	const hive = reg.hives.find( ( h ) => h.id === dev.hive_id );
	const series = CHARTS.find( ( c ) => c[ 0 ] === chart )[ 2 ];
	const act = async ( fn, ok ) => {
		try {
			const r = await fn();
			if ( r && r.id ) {
				setDev( r );
			}
			if ( ok ) {
				toast( ok );
			}
			return r;
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};
	return (
		<div className="nbs-page">
			<a className="nbs-back" href={ href( 'vagar' ) }>← Alla vågar</a>
			<header className="nbs-page-head">
				<div>
					<h1 className="nbs-h1">{ dev.name || dev.id } { dev.dummy && <span className="nbs-badge">Demo</span> }</h1>
					<p className="nbs-muted">{ dev.id } · { hive ? 'Kupa ' + hive.label : 'inte kopplad till en kupa' } · senast sedd { when( dev.last_seen ) }</p>
				</div>
				{ own && (
					<div className="nbs-row-actions">
						<Button variant="ghost" onClick={ () => setModal( 'edit' ) }>Namn och kupa</Button>
						<Button variant="ghost" onClick={ () => setModal( 'cal' ) }>Kalibrera</Button>
						<Button variant="ghost" onClick={ () => setModal( 'share' ) }>Dela</Button>
					</div>
				) }
			</header>
			{ dev.alerts.map( ( a, i ) => <div key={ i } className="nbs-dev-alert is-big">{ a.text }</div> ) }
			<div className="nbs-stats-row">
				<div className="nbs-stat"><span>Vikt</span><strong>{ dev.calibrated ? kg( dev.latest && dev.latest.w ) : 'Ej kalibrerad' }</strong><small>24 tim: { signed( dev.trend_24h_g ) }</small></div>
				<div className="nbs-stat"><span>Inne i kupan</span><strong>{ deg( dev.latest && dev.latest.ti ) }</strong><small>Fukt { dev.latest && dev.latest.rh !== null ? Math.round( dev.latest.rh ) + ' %' : '–' }</small></div>
				<div className="nbs-stat"><span>Ute</span><strong>{ deg( dev.latest && dev.latest.to ) }</strong></div>
				<div className="nbs-stat"><span>Batteri</span><strong>{ dev.battery_v ? dev.battery_v.toLocaleString( 'sv-SE', { minimumFractionDigits: 2 } ) + ' V' : '–' }</strong><small>Uppladdning varje { Math.round( dev.interval_s / 60 ) } min</small></div>
			</div>
			<section className="nbs-card nbs-dev-chart">
				<div className="nbs-card-head">
					<div className="nbs-subtabs" role="tablist" aria-label="Diagram">
						{ CHARTS.map( ( c ) => <button key={ c[ 0 ] } type="button" role="tab" aria-selected={ chart === c[ 0 ] } className={ `nbs-subtab${ chart === c[ 0 ] ? ' is-active' : '' }` } onClick={ () => setChart( c[ 0 ] ) }>{ c[ 1 ] }</button> ) }
					</div>
					<div className="nbs-subtabs" role="group" aria-label="Period">
						{ RANGES.map( ( r ) => <button key={ r[ 0 ] } type="button" aria-pressed={ days === r[ 0 ] } className={ `nbs-subtab${ days === r[ 0 ] ? ' is-active' : '' }` } onClick={ () => setDays( r[ 0 ] ) }>{ r[ 1 ] }</button> ) }
					</div>
				</div>
				{ ! data ? <Loading /> : <LineChart points={ data.points } series={ series } /> }
			</section>
			{ modal === 'edit' && <EditModal dev={ dev } hives={ reg.hives } onClose={ () => setModal( null ) } onSave={ ( body ) => act( () => api( 'devices/' + id, { method: 'PUT', body } ), 'Sparat.' ).then( () => setModal( null ) ) } /> }
			{ modal === 'cal' && <CalModal dev={ dev } onClose={ () => setModal( null ) } onStep={ ( steg, kgv ) => act( () => api( `devices/${ id }/calibrate`, { method: 'POST', body: { steg, kg: kgv } } ), steg === 'noll' ? 'Nollställd.' : 'Kalibrerad.' ) } /> }
			{ modal === 'share' && <ShareModal dev={ dev } onClose={ () => { setModal( null ); reload(); } } /> }
		</div>
	);
}

function EditModal( { dev, hives, onClose, onSave } ) {
	const [ name, setName ] = useState( dev.name || '' );
	const [ hive, setHive ] = useState( dev.hive_id || '' );
	const release = async () => {
		if ( ! window.confirm( 'Ta bort vågen från din organisation? Den får en ny claim-kod som visas en gång.' ) ) {
			return;
		}
		try {
			const r = await api( `devices/${ dev.id }/release`, { method: 'POST' } );
			window.alert( r.claim_code ? 'Ny claim-kod: ' + r.claim_code + '\nSkriv ner den, den visas inte igen.' : 'Vågen är borttagen.' );
			go( 'vagar' );
		} catch ( e ) {
			window.alert( e.message );
		}
	};
	return (
		<Modal title="Namn och kupa" onClose={ onClose } footer={ <><Button variant="ghost" onClick={ release }>Ta bort våg</Button><Button onClick={ () => onSave( { name, hive_id: hive || null } ) }>Spara</Button></> }>
			<div className="nbs-field">
				<label htmlFor="nbs-dev-name">Namn</label>
				<input id="nbs-dev-name" type="text" value={ name } onChange={ ( e ) => setName( e.target.value ) } />
			</div>
			<div className="nbs-field">
				<label htmlFor="nbs-dev-hive">Sitter under kupa</label>
				<select id="nbs-dev-hive" value={ hive } onChange={ ( e ) => setHive( e.target.value ) }>
					<option value="">Ingen kupa</option>
					{ hives.filter( ( h ) => h.active ).map( ( h ) => <option key={ h.id } value={ h.id }>{ h.label }</option> ) }
				</select>
				<small className="nbs-help">En kupa har högst en våg. Väljer du en kupa som redan har en våg flyttas den hit.</small>
			</div>
		</Modal>
	);
}

function CalModal( { dev, onClose, onStep } ) {
	const [ known, setKnown ] = useState( '' );
	return (
		<Modal title="Kalibrera vågen" onClose={ onClose } footer={ <Button variant="ghost" onClick={ onClose }>Klar</Button> }>
			<p><strong>Steg 1: nollställ.</strong> Ta bort allt från vågen (tom plattform), vänta på nästa mätning och tryck.</p>
			<Button onClick={ () => onStep( 'noll' ) }>Nollställ</Button>
			<hr />
			<p><strong>Steg 2: känd vikt.</strong> Lägg en känd vikt på vågen (en hel kupa går bra om du vet vad den väger), vänta på nästa mätning och ange vikten.</p>
			<div className="nbs-field">
				<label htmlFor="nbs-cal-kg">Vikt (kg)</label>
				<input id="nbs-cal-kg" type="text" inputMode="decimal" value={ known } onChange={ ( e ) => setKnown( e.target.value ) } />
			</div>
			<Button disabled={ ! known } onClick={ () => onStep( 'last', parseFloat( known.replace( ',', '.' ) ) ) }>Kalibrera</Button>
			<p className="nbs-muted">{ dev.calibrated ? 'Vågen är kalibrerad. Ny kalibrering rättar även gamla mätvärden, eftersom råvärdena sparas.' : 'Vågen är inte kalibrerad än.' }</p>
		</Modal>
	);
}

function ShareModal( { dev, onClose } ) {
	const toast = useToast();
	const [ email, setEmail ] = useState( '' );
	const [ list, setList ] = useState( dev.shares || [] );
	const add = async () => {
		try {
			const r = await api( `devices/${ dev.id }/share`, { method: 'POST', body: { email } } );
			setList( r.shares || [] );
			setEmail( '' );
			toast( 'Delad.' );
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};
	const remove = async ( uid ) => {
		try {
			await api( `devices/${ dev.id }/share/${ uid }`, { method: 'DELETE' } );
			setList( ( l ) => l.filter( ( x ) => x.user_id !== uid ) );
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};
	return (
		<Modal title="Dela vågen" onClose={ onClose } footer={ <Button variant="ghost" onClick={ onClose }>Klar</Button> }>
			<p className="nbs-muted">Den du delar med kan se vågens värden och grafer, men inte ändra något och inte se dina kupor.</p>
			{ list.length > 0 && (
				<ul className="nbs-list">
					{ list.map( ( s ) => (
						<li key={ s.user_id }>{ s.name } <small className="nbs-muted">{ s.email }</small> <Button variant="ghost" small onClick={ () => remove( s.user_id ) }>Sluta dela</Button></li>
					) ) }
				</ul>
			) }
			<div className="nbs-field">
				<label htmlFor="nbs-share-email">E-post till användaren</label>
				<input id="nbs-share-email" type="email" value={ email } onChange={ ( e ) => setEmail( e.target.value ) } />
			</div>
			<Button disabled={ ! email } onClick={ add }>Dela</Button>
		</Modal>
	);
}

/* ------------------------------------------------------------------ Diagram */

function LineChart( { points, series } ) {
	const W = 720;
	const H = 240;
	const pad = { l: 46, r: 12, t: 12, b: 26 };
	const rows = points.map( ( p ) => ( { t: new Date( p.ts ).getTime(), p } ) );
	const val = ( s, p ) => ( p[ s.key ] === null || p[ s.key ] === undefined ? null : p[ s.key ] * ( s.scale || 1 ) );
	const all = [];
	rows.forEach( ( { p } ) => series.forEach( ( s ) => {
		const v = val( s, p );
		if ( v !== null ) {
			all.push( v );
		}
	} ) );
	if ( rows.length < 2 || all.length < 2 ) {
		return <Empty title="Inga mätvärden i perioden" />;
	}
	let lo = Math.min( ...all );
	let hi = Math.max( ...all );
	if ( hi - lo < 0.5 ) {
		hi += 0.25;
		lo -= 0.25;
	}
	const span = hi - lo;
	lo -= span * 0.06;
	hi += span * 0.06;
	const t0 = rows[ 0 ].t;
	const t1 = rows[ rows.length - 1 ].t;
	const x = ( t ) => pad.l + ( ( t - t0 ) / ( t1 - t0 || 1 ) ) * ( W - pad.l - pad.r );
	const y = ( v ) => pad.t + ( 1 - ( v - lo ) / ( hi - lo ) ) * ( H - pad.t - pad.b );
	const path = ( s ) => {
		let d = '';
		let open = false;
		rows.forEach( ( { t, p } ) => {
			const v = val( s, p );
			if ( v === null ) {
				open = false;
				return;
			}
			d += `${ open ? 'L' : 'M' }${ x( t ).toFixed( 1 ) },${ y( v ).toFixed( 1 ) }`;
			open = true;
		} );
		return d;
	};
	const yt = [ 0, 1, 2, 3, 4 ].map( ( i ) => lo + ( ( hi - lo ) * i ) / 4 );
	const xt = [ 0, 1, 2, 3, 4 ].map( ( i ) => t0 + ( ( t1 - t0 ) * i ) / 4 );
	const fmtY = ( v ) => v.toLocaleString( 'sv-SE', { maximumFractionDigits: Math.abs( hi - lo ) < 10 ? 1 : 0 } );
	const fmtX = ( t ) => new Date( t ).toLocaleDateString( 'sv-SE', { day: 'numeric', month: 'short' } );
	return (
		<figure className="nbs-linechart">
			<svg viewBox={ `0 0 ${ W } ${ H }` } role="img" aria-label={ series.map( ( s ) => s.label ).join( ', ' ) }>
				{ yt.map( ( v, i ) => (
					<g key={ i }>
						<line x1={ pad.l } x2={ W - pad.r } y1={ y( v ) } y2={ y( v ) } stroke="#E2CFAE" strokeWidth="1" />
						<text x={ pad.l - 6 } y={ y( v ) + 4 } textAnchor="end" fontSize="11" fill="#5C4630">{ fmtY( v ) }</text>
					</g>
				) ) }
				{ xt.map( ( t, i ) => <text key={ i } x={ x( t ) } y={ H - 6 } textAnchor={ i === 0 ? 'start' : i === 4 ? 'end' : 'middle' } fontSize="11" fill="#5C4630">{ fmtX( t ) }</text> ) }
				{ series.map( ( s ) => <path key={ s.key } d={ path( s ) } fill="none" stroke={ s.color } strokeWidth="2" strokeLinejoin="round" /> ) }
			</svg>
			<figcaption className="nbs-linechart-legend">
				{ series.map( ( s ) => <span key={ s.key }><i style={ { background: s.color } } />{ s.label }</span> ) }
			</figcaption>
		</figure>
	);
}

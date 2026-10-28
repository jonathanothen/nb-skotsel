import { useState } from '@wordpress/element';
import { api } from '../api';
import { href } from '../router';
import { useMe } from '../App';
import { useRegister, today, fmtDate } from '../register';
import { useLoad, Loading, ErrorBox, Button, Empty, useToast } from '../ui';
import { FieldInput } from '../fields';
import { RecordForm, SubTabs, YearSelect, Table, Stat, thisYear, fmtNum, fmtKr } from '../records';

const M = [ 'Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec' ];
const zero = () => Array( 12 ).fill( 0 );
const sum = ( a ) => a.reduce( ( s, v ) => s + ( Number( v ) || 0 ), 0 );
const add = ( a, b ) => a.map( ( v, i ) => v + ( b[ i ] || 0 ) );

export default function Economy( { route } ) {
	const reg = useRegister();
	const me = useMe();
	const [ year, setYear ] = useState( thisYear() );
	const [ stamp, setStamp ] = useState( 0 );
	const [ eco, error ] = useLoad( () => api( 'economy?year=' + year ), [ year, stamp ] );
	// Budgetkategorierna med typ (intäkt/kostnad) och moms.
	const [ accounts ] = useLoad( () => api( 'lists' ).then( ( ls ) => {
		const l = ls.find( ( x ) => x.key === 'konton' );
		return l ? api( 'lists/' + l.id ).then( ( r ) => ( { list: l, items: r.items } ) ) : { list: null, items: [] };
	} ) );
	const tab = route[ 0 ] || 'oversikt';
	if ( reg.error || error ) {
		return <div className="nbs-page"><ErrorBox error={ reg.error || error } /></div>;
	}
	if ( reg.loading || ! eco || ! accounts ) {
		return <Loading />;
	}
	const acc = Object.fromEntries( accounts.items.map( ( a ) => [ a.id, a ] ) );
	const isIncome = ( id ) => acc[ id ] && acc[ id ].data.typ === 'Intäkt';
	const bump = () => setStamp( ( s ) => s + 1 );

	return (
		<div className="nbs-page">
			<header className="nbs-page-head">
				<div>
					<h1 className="nbs-h1">Ekonomi</h1>
					<p className="nbs-muted">Budget mot utfall, investeringar, moms och nyckeltal per samhälle och kg honung. Belopp exklusive moms.</p>
				</div>
				<div className="nbs-row-actions">
					<YearSelect value={ year } onChange={ setYear } />
					{ accounts.list && <a className="nbs-btn is-ghost" href={ href( 'listor/' + accounts.list.id ) }>Budgetkategorier</a> }
				</div>
			</header>
			<SubTabs label="Ekonomi" current={ tab } tabs={ [ [ 'oversikt', 'Översikt', href( 'ekonomi' ) ], [ 'budget', 'Budget', href( 'ekonomi/budget' ) ], [ 'utfall', 'Utfall', href( 'ekonomi/utfall' ) ], [ 'investeringar', 'Investeringar', href( 'ekonomi/investeringar' ) ] ] } />
			{ tab === 'oversikt' && <Overview eco={ eco } year={ year } isIncome={ isIncome } acc={ acc } onChanged={ bump } /> }
			{ tab === 'budget' && <Budget eco={ eco } year={ year } acc={ acc } isIncome={ isIncome } canWrite={ me.can.write } onChanged={ bump } /> }
			{ tab === 'utfall' && <Ledger eco={ eco } year={ year } acc={ acc } isIncome={ isIncome } canWrite={ me.can.write } onChanged={ bump } /> }
			{ tab === 'investeringar' && <Investments eco={ eco } year={ year } canWrite={ me.can.write } onChanged={ bump } /> }
		</div>
	);
}

/** Avskrivning per månad ett år: belopp / nyttjandeår / 12 från inköpsmånaden. */
function depreciation( investments, year ) {
	const m = zero();
	investments.forEach( ( i ) => {
		if ( ! i.month || ! i.amount || ! i.years ) {
			return;
		}
		const [ y0, m0 ] = i.month.split( '-' ).map( Number );
		const start = y0 * 12 + ( m0 - 1 );
		const end = start + i.years * 12;
		for ( let k = 0; k < 12; k++ ) {
			const idx = year * 12 + k;
			if ( idx >= start && idx < end ) {
				m[ k ] += i.amount / i.years / 12;
			}
		}
	} );
	return m;
}

function totals( eco, year, isIncome ) {
	const bIn = zero();
	const bOut = zero();
	eco.budget.forEach( ( b ) => {
		const months = ( b.months || [] ).map( ( v ) => Number( v ) || 0 );
		if ( isIncome( b.account_id ) ) {
			bIn.splice( 0, 12, ...add( bIn, months ) );
		} else {
			bOut.splice( 0, 12, ...add( bOut, months ) );
		}
	} );
	const uIn = zero();
	const uOut = zero();
	eco.ledger.forEach( ( l ) => {
		const k = Number( l.entry_date.slice( 5, 7 ) ) - 1;
		( isIncome( l.account_id ) ? uIn : uOut )[ k ] += l.amount || 0;
	} );
	const stock = eco.purchases.map( Number );
	const dep = depreciation( eco.investments, year );
	return { bIn, bOut, uIn, uOut: add( uOut, stock ), stock, dep };
}

/* ------------------------------------------------------------------ Översikt */

function Overview( { eco, year, isIncome, acc, onChanged } ) {
	const k = eco.kpi;
	const t = totals( eco, year, isIncome );
	const costs = sum( t.uOut ) + sum( t.dep );
	const income = sum( t.uIn );
	const result = income - costs;
	const rows = [
		[ 'Intäkter, budget', t.bIn ],
		[ 'Intäkter, utfall', t.uIn ],
		[ 'Kostnader, budget', t.bOut ],
		[ 'Kostnader, utfall', t.uOut, 'Inklusive lagerinköp' ],
		[ 'Avskrivningar', t.dep ],
		[ 'Resultat, budget', t.bIn.map( ( v, i ) => v - t.bOut[ i ] - t.dep[ i ] ), null, true ],
		[ 'Resultat, utfall', t.uIn.map( ( v, i ) => v - t.uOut[ i ] - t.dep[ i ] ), null, true ],
	];
	// Moms per kvartal från utfallet: utgående på intäkter, ingående på kostnader.
	const vat = [ 0, 0, 0, 0 ].map( () => ( { out: 0, in: 0 } ) );
	eco.ledger.forEach( ( l ) => {
		const q = Math.floor( ( Number( l.entry_date.slice( 5, 7 ) ) - 1 ) / 3 );
		const v = ( ( l.amount || 0 ) * ( l.vat || 0 ) ) / 100;
		if ( isIncome( l.account_id ) ) {
			vat[ q ].out += v;
		} else {
			vat[ q ].in += v;
		}
	} );
	const plan = eco.settings.growth_plan || [];
	const yearNo = year - ( eco.settings.start_year || 2027 ) + 1;
	return (
		<>
			<div className="nbs-stats-row">
				<Stat label="Samhällen vid årets början" value={ k.colonies_start } sub={ `${ k.colonies_now } nu · ${ k.new } nya` } />
				<Stat label="Förluster" value={ k.loss_pct === null ? '–' : `${ fmtNum( k.loss_pct ) } %` } sub={ `${ k.dead } döda · ${ k.sold } sålda` } />
				<Stat label="Honung" value={ `${ fmtNum( k.honey_kg ) } kg` } sub={ k.kg_per_colony !== null ? `${ fmtNum( k.kg_per_colony ) } kg per samhälle` : '' } />
				<Stat label="Kostnad per samhälle" value={ k.colonies_start ? fmtKr( costs / k.colonies_start ) : '–' } sub={ `förbrukat material ${ fmtKr( eco.consumed ) }` } />
				<Stat label="Kostnad per kg honung" value={ k.honey_kg ? fmtKr( costs / k.honey_kg ) : '–' } />
				<Stat label="Resultat (utfall)" value={ fmtKr( result ) } sub={ `intäkter ${ fmtKr( income ) }` } />
				<Stat label="Foder" value={ k.ts_per_colony !== null ? `${ fmtNum( k.ts_per_colony ) } kg ts` : '–' } sub={ `per fodrat samhälle (${ k.fed_colonies })` } />
				<Stat label="Besök och behandlingar" value={ k.visits } sub={ `${ k.treatments } behandlingar` } />
			</div>
			<section className="nbs-card nbs-mt">
				<h2 className="nbs-h2">Budget mot utfall { year }</h2>
				<div className="nbs-table-wrap nbs-econ">
					<table className="nbs-table">
						<thead><tr><th>Kr exkl. moms</th>{ M.map( ( m ) => <th key={ m } className="is-num">{ m }</th> ) }<th className="is-num">Totalt</th></tr></thead>
						<tbody>
							{ rows.map( ( [ l, v, help, strong ] ) => (
								<tr key={ l } className={ strong ? 'is-strong' : '' }>
									<td title={ help || '' }>{ l }</td>
									{ v.map( ( x, i ) => <td key={ i } className={ `is-num${ x < 0 ? ' is-neg' : '' }` }>{ x ? fmtNum( Math.round( x ) ) : '' }</td> ) }
									<td className="is-num"><strong>{ fmtNum( Math.round( sum( v ) ) ) }</strong></td>
								</tr>
							) ) }
						</tbody>
					</table>
				</div>
			</section>
			<div className="nbs-grid">
				<section className="nbs-card">
					<h2 className="nbs-h2">Moms per kvartal (utfall)</h2>
					<Table rows={ vat.map( ( v, i ) => ( { id: i, ...v } ) ) } cols={ [ [ 'Kvartal', ( r ) => `Q${ r.id + 1 }` ], [ 'Utgående', ( r ) => fmtKr( r.out ), 'is-num' ], [ 'Ingående', ( r ) => fmtKr( r.in ), 'is-num' ], [ 'Att betala', ( r ) => <strong>{ fmtKr( r.out - r.in ) }</strong>, 'is-num' ] ] } />
					<p className="nbs-muted">Räknas på utfallsposterna med momssats. Lagerinköp har ingen moms registrerad.</p>
				</section>
				<GrowthPlan plan={ plan } eco={ eco } yearNo={ yearNo } onChanged={ onChanged } />
			</div>
		</>
	);
}

function GrowthPlan( { plan, eco, yearNo, onChanged } ) {
	const me = useMe();
	const toast = useToast();
	const [ edit, setEdit ] = useState( false );
	const [ rows, setRows ] = useState( plan );
	const [ start, setStart ] = useState( eco.settings.start_year || 2027 );
	const save = async () => {
		try {
			await api( 'modules', { method: 'PUT', body: { growth_plan: rows, start_year: start } } );
			toast( 'Tillväxtplanen sparades.' );
			setEdit( false );
			onChanged();
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};
	return (
		<section className="nbs-card">
			<div className="nbs-card-head">
				<h2 className="nbs-h2">Tillväxtplan</h2>
				{ me.can.manage && <button type="button" className="nbs-link-btn" onClick={ () => setEdit( ! edit ) }>{ edit ? 'Stäng' : 'Ändra' }</button> }
			</div>
			{ edit ? (
				<div className="nbs-form">
					<FieldInput field={ { key: 'gp_start', label: 'År 1 är', type: 'number' } } value={ start } onChange={ ( v ) => setStart( Number( v ) || start ) } />
					{ rows.map( ( r, i ) => (
						<div key={ i } className="nbs-form-row">
							<FieldInput field={ { key: 'gp_y' + i, label: 'År nr', type: 'number' } } value={ r.year } onChange={ ( v ) => setRows( ( a ) => a.map( ( x, j ) => ( j === i ? { ...x, year: Number( v ) } : x ) ) ) } />
							<FieldInput field={ { key: 'gp_c' + i, label: 'Samhällen', type: 'number' } } value={ r.colonies } onChange={ ( v ) => setRows( ( a ) => a.map( ( x, j ) => ( j === i ? { ...x, colonies: Number( v ) } : x ) ) ) } />
							<FieldInput field={ { key: 'gp_k' + i, label: 'Honung (kg)', type: 'number' } } value={ r.kg } onChange={ ( v ) => setRows( ( a ) => a.map( ( x, j ) => ( j === i ? { ...x, kg: Number( v ) } : x ) ) ) } />
						</div>
					) ) }
					<div className="nbs-row-actions">
						<Button small variant="ghost" onClick={ () => setRows( ( a ) => [ ...a, { year: ( a[ a.length - 1 ] || { year: 0 } ).year + 1, colonies: 0, kg: 0 } ] ) }>+ År</Button>
						<Button small onClick={ save }>Spara</Button>
					</div>
				</div>
			) : (
				<Table
					rows={ plan.map( ( p ) => ( { id: p.year, ...p } ) ) }
					cols={ [
						[ 'År', ( p ) => `År ${ p.year } (${ ( eco.settings.start_year || 2027 ) + p.year - 1 })` ],
						[ 'Samhällen', ( p ) => <>{ p.colonies }{ p.year === yearNo && <span className="nbs-muted"> · utfall { eco.kpi.colonies_start }</span> }</>, 'is-num' ],
						[ 'Honung', ( p ) => <>{ fmtNum( p.kg ) } kg{ p.year === yearNo && <span className="nbs-muted"> · utfall { fmtNum( eco.kpi.honey_kg ) }</span> }</>, 'is-num' ],
					] }
				/>
			) }
		</section>
	);
}

/* ------------------------------------------------------------------ Budget */

function MonthsInput( { form, set } ) {
	const months = form.months && form.months.length === 12 ? form.months : zero();
	const upd = ( i, v ) => set( 'months', months.map( ( x, j ) => ( j === i ? v : x ) ) );
	const [ total, setTotal ] = useState( '' );
	return (
		<div className="nbs-field">
			<label>Belopp per månad (kr exkl. moms)</label>
			<div className="nbs-months">
				{ M.map( ( m, i ) => (
					<label key={ m }><span>{ m }</span><input type="text" inputMode="decimal" value={ months[ i ] || '' } onChange={ ( e ) => upd( i, Number( e.target.value.replace( ',', '.' ).replace( /\s/g, '' ) ) || 0 ) } /></label>
				) ) }
			</div>
			<div className="nbs-inline-form">
				<input type="text" inputMode="decimal" value={ total } onChange={ ( e ) => setTotal( e.target.value ) } placeholder="Årsbelopp" aria-label="Årsbelopp att fördela" />
				<Button small variant="ghost" onClick={ () => set( 'months', Array( 12 ).fill( Math.round( ( Number( total.replace( ',', '.' ).replace( /\s/g, '' ) ) || 0 ) / 12 ) ) ) }>Fördela jämnt</Button>
				<span className="nbs-muted">Summa { fmtNum( sum( months ) ) } kr</span>
			</div>
		</div>
	);
}

function Budget( { eco, year, acc, isIncome, canWrite, onChanged } ) {
	const [ editing, setEditing ] = useState( null );
	const toast = useToast();
	const fields = [
		{ key: 'account_id', label: 'Kategori', type: 'ref', ref: 'konton', required: true },
		{ key: 'description', label: 'Beskrivning', type: 'text', required: true },
		{ key: 'vat', label: 'Moms', type: 'number', unit: '%' },
		{ key: 'months', label: 'Månader', wide: true, render: ( form, set ) => <MonthsInput form={ form } set={ set } /> },
		{ key: 'note', label: 'Notering', type: 'textarea' },
	];
	const copyLast = async () => {
		try {
			const prev = await api( `r/budget?year=${ year - 1 }` );
			for ( const b of prev ) {
				await api( 'r/budget', { method: 'POST', body: { year, account_id: b.account_id, description: b.description, vat: b.vat, months: b.months, note: b.note } } );
			}
			toast( `${ prev.length } rader kopierades från ${ year - 1 }.` );
			onChanged();
		} catch ( e ) {
			toast( e.message, 'error' );
		}
	};
	const groups = [ [ 'Intäkter', eco.budget.filter( ( b ) => isIncome( b.account_id ) ) ], [ 'Kostnader', eco.budget.filter( ( b ) => ! isIncome( b.account_id ) ) ] ];
	return (
		<>
			<div className="nbs-toolbar">
				<span className="nbs-muted">Budgetrader per kategori och månad, som i budgetmallen.</span>
				<span className="nbs-spacer" />
				{ canWrite && eco.budget.length === 0 && <Button variant="ghost" onClick={ copyLast }>Kopiera från { year - 1 }</Button> }
				{ canWrite && <Button onClick={ () => setEditing( { year, months: zero() } ) }>+ Budgetrad</Button> }
			</div>
			{ eco.budget.length === 0 && <Empty title={ `Ingen budget för ${ year }` }><p>Lägg in budgetraderna (t.ex. honung 3 ton, burkar, foderdeg, socker, fordon) så jämförs de med utfallet.</p></Empty> }
			{ groups.map( ( [ name, rows ] ) => rows.length > 0 && (
				<section key={ name } className="nbs-card nbs-mt">
					<h2 className="nbs-h2">{ name } <span className="nbs-count">{ fmtKr( sum( rows.map( ( r ) => sum( r.months || [] ) ) ) ) }</span></h2>
					<Table rows={ rows } onOpen={ canWrite ? setEditing : undefined } cols={ [ [ 'Beskrivning', ( b ) => <strong>{ b.description }</strong> ], [ 'Kategori', ( b ) => ( acc[ b.account_id ] ? acc[ b.account_id ].name : '–' ) ], [ 'Moms', ( b ) => ( b.vat !== null ? `${ fmtNum( b.vat ) } %` : '–' ), 'is-num' ], [ 'Per år', ( b ) => fmtKr( sum( b.months || [] ) ), 'is-num' ] ] } />
				</section>
			) ) }
			{ editing && <RecordForm type="budget" wide title={ editing.id ? editing.description : 'Ny budgetrad' } fields={ fields } item={ editing.id ? editing : {} } preset={ editing.id ? {} : editing } onClose={ () => setEditing( null ) } onSaved={ onChanged } /> }
		</>
	);
}

/* ------------------------------------------------------------------ Utfall */

function Ledger( { eco, year, acc, isIncome, canWrite, onChanged } ) {
	const [ editing, setEditing ] = useState( null );
	const fields = [
		{ key: 'entry_date', label: 'Datum', type: 'date' },
		{ key: 'account_id', label: 'Kategori', type: 'ref', ref: 'konton', required: true },
		{ key: 'description', label: 'Beskrivning', type: 'text', required: true, wide: true },
		{ key: 'amount', label: 'Belopp exkl. moms', type: 'number', unit: 'kr' },
		{ key: 'vat', label: 'Moms', type: 'number', unit: '%' },
		{ key: 'note', label: 'Notering', type: 'textarea' },
	];
	const stock = sum( eco.purchases );
	return (
		<>
			<div className="nbs-toolbar">
				<span className="nbs-muted">Verkliga intäkter och kostnader. Inköp som bokas i lagret räknas med automatiskt ({ fmtKr( stock ) } { year }).</span>
				<span className="nbs-spacer" />
				{ canWrite && <Button onClick={ () => setEditing( { entry_date: today() } ) }>+ Post</Button> }
			</div>
			<Table
				rows={ eco.ledger }
				onOpen={ canWrite ? setEditing : undefined }
				empty="Inga poster det här året."
				cols={ [
					[ 'Datum', ( l ) => fmtDate( l.entry_date ) ],
					[ 'Beskrivning', ( l ) => l.description ],
					[ 'Kategori', ( l ) => ( acc[ l.account_id ] ? acc[ l.account_id ].name : '–' ) ],
					[ 'Belopp', ( l ) => <span className={ isIncome( l.account_id ) ? 'nbs-ok' : '' }>{ isIncome( l.account_id ) ? '+' : '−' }{ fmtKr( l.amount ) }</span>, 'is-num' ],
					[ 'Moms', ( l ) => ( l.vat !== null ? `${ fmtNum( l.vat ) } %` : '–' ), 'is-num' ],
				] }
			/>
			{ editing && <RecordForm type="ledger" title={ editing.id ? editing.description : 'Ny post' } fields={ fields } item={ editing.id ? editing : {} } preset={ editing.id ? {} : editing } onClose={ () => setEditing( null ) } onSaved={ onChanged } /> }
		</>
	);
}

/* ------------------------------------------------------------------ Investeringar */

function Investments( { eco, year, canWrite, onChanged } ) {
	const [ editing, setEditing ] = useState( null );
	const fields = [
		{ key: 'name', label: 'Investering', type: 'text', required: true, wide: true },
		{ key: 'month', label: 'Inköpsmånad (ÅÅÅÅ-MM)', type: 'text' },
		{ key: 'amount', label: 'Belopp exkl. moms', type: 'number', unit: 'kr' },
		{ key: 'vat', label: 'Moms', type: 'number', unit: '%' },
		{ key: 'years', label: 'Nyttjandeår', type: 'number', min: 1 },
		{ key: 'note', label: 'Notering', type: 'textarea' },
	];
	const dep = ( i ) => sum( depreciation( [ i ], year ) );
	return (
		<>
			<div className="nbs-toolbar">
				<span className="nbs-muted">Avskrivning = belopp / nyttjandeår, fördelat per månad från inköpsmånaden.</span>
				<span className="nbs-spacer" />
				{ canWrite && <Button onClick={ () => setEditing( { month: today().slice( 0, 7 ), vat: 25, years: 5 } ) }>+ Investering</Button> }
			</div>
			<Table
				rows={ eco.investments }
				onOpen={ canWrite ? setEditing : undefined }
				empty="Inga investeringar."
				cols={ [
					[ 'Investering', ( i ) => <strong>{ i.name }</strong> ],
					[ 'Inköp', ( i ) => i.month || '–' ],
					[ 'Belopp', ( i ) => fmtKr( i.amount ), 'is-num' ],
					[ 'Nyttjandeår', ( i ) => i.years || '–', 'is-num' ],
					[ `Avskrivning ${ year }`, ( i ) => fmtKr( dep( i ) ), 'is-num' ],
				] }
			/>
			{ editing && <RecordForm type="investment" title={ editing.id ? editing.name : 'Ny investering' } fields={ fields } item={ editing.id ? editing : {} } preset={ editing.id ? {} : editing } onClose={ () => setEditing( null ) } onSaved={ onChanged } /> }
		</>
	);
}

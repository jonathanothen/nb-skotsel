import { createContext, useContext, useEffect, useRef, useState, useCallback } from '@wordpress/element';

/** Små gemensamma komponenter: knappar, modal, meddelanden, tomt läge. */

const ToastCtx = createContext( () => {} );

export function ToastProvider( { children } ) {
	const [ toasts, setToasts ] = useState( [] );
	const push = useCallback( ( text, type = 'ok' ) => {
		const id = Math.random().toString( 36 ).slice( 2 );
		setToasts( ( t ) => [ ...t, { id, text, type } ] );
		setTimeout( () => setToasts( ( t ) => t.filter( ( x ) => x.id !== id ) ), type === 'error' ? 6000 : 2800 );
	}, [] );
	return (
		<ToastCtx.Provider value={ push }>
			{ children }
			<div className="nbs-toasts" aria-live="polite">
				{ toasts.map( ( t ) => (
					<div key={ t.id } className={ `nbs-toast is-${ t.type }` }>{ t.text }</div>
				) ) }
			</div>
		</ToastCtx.Provider>
	);
}

export const useToast = () => useContext( ToastCtx );

export function Button( { variant = 'primary', small, className = '', ...rest } ) {
	return <button type="button" className={ `nbs-btn is-${ variant }${ small ? ' is-small' : '' } ${ className }` } { ...rest } />;
}

export function Modal( { title, onClose, children, footer, wide } ) {
	const ref = useRef();
	useEffect( () => {
		const onKey = ( e ) => e.key === 'Escape' && onClose();
		document.addEventListener( 'keydown', onKey );
		const first = ref.current && ref.current.querySelector( 'input, select, textarea' );
		if ( first ) {
			first.focus();
		}
		return () => document.removeEventListener( 'keydown', onKey );
	}, [] );
	return (
		<div className="nbs-modal-backdrop" onMouseDown={ ( e ) => e.target === e.currentTarget && onClose() }>
			<div className={ `nbs-modal${ wide ? ' is-wide' : '' }` } role="dialog" aria-modal="true" aria-label={ title } ref={ ref }>
				<header className="nbs-modal-head">
					<h2>{ title }</h2>
					<button type="button" className="nbs-icon-btn" onClick={ onClose } aria-label="Stäng">×</button>
				</header>
				<div className="nbs-modal-body">{ children }</div>
				{ footer && <footer className="nbs-modal-foot">{ footer }</footer> }
			</div>
		</div>
	);
}

export function Empty( { title, children } ) {
	return (
		<div className="nbs-empty">
			<h3>{ title }</h3>
			{ children }
		</div>
	);
}

export function Loading() {
	return <div className="nbs-loading" aria-busy="true">Laddar…</div>;
}

export function ErrorBox( { error } ) {
	return error ? <div className="nbs-error" role="alert">{ String( error.message || error ) }</div> : null;
}

/** Laddar data från en async-funktion; returnerar [data, error, reload, setData]. */
export function useLoad( fn, deps = [] ) {
	const [ state, setState ] = useState( { data: null, error: null } );
	const load = useCallback( () => {
		let alive = true;
		fn().then(
			( data ) => alive && setState( { data, error: null } ),
			( error ) => alive && setState( { data: null, error } )
		);
		return () => {
			alive = false;
		};
	}, deps ); // eslint-disable-line react-hooks/exhaustive-deps
	useEffect( load, [ load ] );
	const setData = ( d ) => setState( ( s ) => ( { ...s, data: typeof d === 'function' ? d( s.data ) : d } ) );
	return [ state.data, state.error, load, setData ];
}

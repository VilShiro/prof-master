const {useState, useEffect} = React;
const html = htm.bind(React.createElement);
const fmt = (n) => n.toLocaleString('ru-RU') + ' Byn';
const api = (url, body) =>
    fetch(url, body && {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    }).then((r) => r.json());

const Car = ({color}) => html`
    <svg viewBox="0 0 300 110" role="img" aria-label="Автомобиль">
        <path d="M10 80Q10 62 35 58L75 52Q95 28 140 28L190 28Q220 32 235 52L280 58Q292 62 292 80Z" fill=${color}
              stroke="#0002"/>
        <circle cx="75" cy="82" r="16" fill="#111"/>
        <circle cx="225" cy="82" r="16" fill="#111"/>
    </svg>`;

const Row = ({name, price, why, on, onClick}) => html`
    <button className=${'row' + (on ? ' on' : '') + (why ? ' off' : '')} aria-pressed=${on} aria-disabled=${!!why}
            onClick=${onClick}>
        <span>${name}${why && html`<small>${why}</small>`}</span><span>${price ? '+ ' + fmt(price) : ''}</span>
    </button>`;

function App() {
    const [cat, setCat] = useState(null);
    const [cfg, setCfg] = useState({model: 'S', trim: 'comfort', color: 'white', options: []});
    const [q, setQ] = useState(null);
    const [msg, setMsg] = useState([]);
    const [order, setOrder] = useState(null);

    useEffect(() => {
        api('/api/catalog').then(setCat);
    }, []);
    useEffect(() => {
        api('/api/quote', cfg).then((r) => {
            setQ(r);
            if (r.removed.length) {
                setMsg(r.removed);
                setCfg(r.config);
            }
        });
    }, [cfg]);

    if (!cat || !q) return html`
        <main>Загрузка…</main>`;

    const change = (p) => {
        setMsg([]);
        setCfg({...cfg, ...p});
    };
    const toggle = (id, why) => {
        if (why) return setMsg([why]);
        change({options: cfg.options.includes(id) ? cfg.options.filter((x) => x !== id) : [...cfg.options, id]});
    };
    const finish = () => api('/api/order', cfg).then(setOrder);

    const summary = html`
        <div>${q.lines.map((l, i) => html`
            <div className="line" key=${i}><span>${l.name}</span><span>${l.price ? fmt(l.price) : '—'}</span></div>`)}
        </div>`;

    if (order) return html`
        <main>
            <${Car} color=${cat.colors[cfg.color].hex}/>
                <h1>Заявка ${order.id} отправлена</h1>
                ${summary}
                <h2>Итого: ${fmt(order.total)}</h2>
                <button className="btn light" onClick=${() => setOrder(null)}>Изменить конфигурацию</button>
        </main>`;

    return html`
        <main>
            <${Car} color=${cat.colors[cfg.color].hex}/>
                <h1>Соберите свой Aster</h1>
                ${msg.map((m) => html`
                    <div className="msg" key=${m} role="status">${m}</div>`)}

                <h2>Модель</h2>
                ${Object.entries(cat.models).map(([id, m]) => html`
                    <${Row} key=${id} name=${m.name} price=${m.price} on=${cfg.model === id}
                            onClick=${() => change({model: id})}/>`)}

                <h2>Комплектация</h2>
                ${Object.entries(cat.trims).map(([id, t]) => html`
                    <${Row} key=${id} name=${t.name} price=${t.price} on=${cfg.trim === id}
                            onClick=${() => change({trim: id})}/>`)}

                <h2>Цвет</h2>
                ${Object.entries(cat.colors).map(([id, c]) => {
                    const why = q.disabled.colors[id];
                    return html`
                        <${Row} key=${id} name=${c.name} price=${c.price} why=${why} on=${cfg.color === id}
                                onClick=${() => (why ? setMsg([why]) : change({color: id}))}/>`;
                })}

                <h2>Опции</h2>
                ${Object.entries(cat.options).map(([id, o]) => {
                    const why = q.disabled.options[id];
                    return html`
                        <${Row} key=${id} name=${o.name} price=${o.price} why=${why} on=${cfg.options.includes(id)}
                                onClick=${() => toggle(id, why)}/>`;
                })}

                <h2>Ваша конфигурация</h2>
                ${summary}

                <div className="bar">
                    <div><b>${fmt(q.total)}</b>
                        <button className="btn" onClick=${finish}>Завершить выбор</button>
                    </div>
                </div>
        </main>`;
}

ReactDOM.createRoot(document.getElementById('root')).render(html`
    <${App}/>`);
/* ========================================
   MEDIPRINT · CLIENTE PÚBLICO DE SUPABASE
   ----------------------------------------
   Sin dependencias. Solo usa la clave pública y dos operaciones:
     1. Leer el catálogo activo (RLS: solo productos/categorías activos).
     2. Registrar una solicitud vía RPC submit_quote_request.
   Cualquier falla devuelve null / false: la web sigue usando el
   catálogo local y WhatsApp como siempre.
   ======================================== */

(function () {
    const config = window.MEDIPRINT_SUPABASE || {};
    const baseUrl = String(config.url || '').replace(/\/+$/, '');
    const key = String(config.publishableKey || '');

    function isConfigured() {
        return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(baseUrl) && key.length > 20;
    }

    function headers(extra) {
        const result = { apikey: key, Accept: 'application/json', ...extra };
        // Las claves anon antiguas son JWT y van también como Bearer;
        // las nuevas sb_publishable_ solo en `apikey`.
        if (key.startsWith('eyJ')) result.Authorization = `Bearer ${key}`;
        return result;
    }

    function publicImageUrl(path) {
        if (!path) return 'images/mediprint-logo.png';
        if (/^products\//.test(path)) {
            return `${baseUrl}/storage/v1/object/public/product-images/${path.split('/').map(encodeURIComponent).join('/')}`;
        }
        if (/^https:\/\//.test(path)) return path;
        return path.replace(/^\/+/, '');
    }

    const bySort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name));

    function toCatalogProduct(row) {
        const kind = row.category?.kind === 'web' ? 'web' : 'printed';
        const base = {
            id: row.id,
            name: row.name,
            description: row.description || '',
            specs: row.specs || '',
            image: publicImageUrl(row.image_path),
            unitLabel: row.unit_label || 'unidades',
            packPricing: Boolean(row.pack_pricing),
            outOfStock: row.track_stock === true && row.stock_status === 'agotado',
            source: 'supabase'
        };

        if (kind === 'web' || row.pricing_mode === 'quote') {
            return {
                ...base,
                category: kind === 'web' ? 'web' : undefined,
                webService: kind === 'web',
                quoteOnly: kind !== 'web',
                priceLabel: row.price_label || 'A cotizar',
                features: row.features || '',
                externalUrl: row.external_url || '',
                whatsappNumber: row.whatsapp_number || ''
            };
        }

        const extras = (row.product_extras || [])
            .filter(extra => extra.is_active !== false)
            .sort(bySort)
            .map(extra => [extra.name, Number(extra.surcharge_percent) || 0]);

        const product = {
            ...base,
            extras: extras.length ? extras : undefined,
            exclusive: Boolean(row.extras_exclusive)
        };

        if (row.pricing_mode === 'unit') {
            const rules = row.pricing_rules || {};
            const unitPrices = Array.isArray(rules.unit_prices) ? rules.unit_prices : [];
            if (!unitPrices.length && !row.base_net_price) return null;
            return {
                ...product,
                unitPricing: true,
                unitOptionLabel: /^credencial/i.test(row.name) ? 'Credencial PVC' : row.name,
                pricingRules: {
                    unitPrices: unitPrices.length ? unitPrices : [{ up_to: null, net_price: row.base_net_price }],
                    designFee: Number(rules.design_fee) || 0,
                    designFreeFrom: Number(rules.design_free_from) || 0
                }
            };
        }

        const variants = {};
        (row.product_variants || [])
            .filter(variant => variant.is_active !== false)
            .sort(bySort)
            .forEach(variant => {
                const tiers = (variant.product_price_tiers || [])
                    .map(tier => [Number(tier.quantity), Number(tier.net_price)])
                    .filter(([qty, price]) => qty > 0 && price >= 0)
                    .sort((a, b) => a[0] - b[0]);
                if (tiers.length) variants[variant.name] = tiers;
            });

        // Un producto por tramos sin precios no se muestra (evita tarjetas rotas)
        if (!Object.keys(variants).length) return null;
        return { ...product, variants };
    }

    async function loadCatalog({ timeoutMs = 4000 } = {}) {
        if (!isConfigured()) return null;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const select = [
            'id,name,description,specs,features,image_path,pricing_mode,unit_label,pack_pricing,extras_exclusive',
            'base_net_price,pricing_rules,price_label,external_url,whatsapp_number,sort_order,track_stock,stock_status',
            'category:categories!inner(kind,sort_order,is_active)',
            'product_variants(name,sort_order,is_active,product_price_tiers(quantity,net_price))',
            'product_extras(name,surcharge_percent,sort_order,is_active)'
        ].join(',');

        try {
            const response = await fetch(
                `${baseUrl}/rest/v1/products?select=${encodeURIComponent(select)}&is_active=eq.true&order=sort_order.asc,name.asc`,
                { headers: headers(), signal: controller.signal, cache: 'no-store' }
            );
            if (!response.ok) throw new Error(`Catálogo respondió ${response.status}`);
            const rows = await response.json();
            if (!Array.isArray(rows)) throw new Error('Formato de catálogo inesperado');

            const catalog = rows
                .sort((a, b) => (a.category?.sort_order ?? 0) - (b.category?.sort_order ?? 0) || bySort(a, b))
                .map(toCatalogProduct)
                .filter(Boolean);
            return catalog.length ? catalog : null;
        } catch (error) {
            console.warn('MediPrint: se usa el catálogo local.', error.message || error);
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    /* Registro en segundo plano: nunca bloquea WhatsApp */
    function submitQuote(payload) {
        if (!isConfigured()) return Promise.resolve(false);
        try {
            return fetch(`${baseUrl}/rest/v1/rpc/submit_quote_request`, {
                method: 'POST',
                headers: headers({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ p_payload: payload }),
                keepalive: true
            })
                .then(response => response.ok)
                .catch(error => {
                    console.warn('MediPrint: no se pudo registrar la solicitud.', error.message || error);
                    return false;
                });
        } catch (error) {
            return Promise.resolve(false);
        }
    }

    window.MediprintSupabase = Object.freeze({ isConfigured, loadCatalog, submitQuote, publicImageUrl });
})();

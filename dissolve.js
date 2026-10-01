/* Bounded, cancellable visual effect. No screenshots, canvas reads or cloned players. */
(function (root) {
    'use strict';
    function createController() {
        const active = new Map();
        let layer = null, shadow = null;
        const reducedMotion = root.matchMedia?.('(prefers-reduced-motion: reduce)');
        function removeLayerIfEmpty() {
            if (!active.size && layer) { layer.remove(); layer = shadow = null; }
        }
        function cancel(element) {
            const effect = active.get(element);
            if (!effect) return;
            active.delete(element);
            root.clearTimeout(effect.timer);
            element.removeAttribute('data-ytfc-dissolving');
            for (const animation of effect.animations) { animation.onfinish = null; animation.cancel(); }
            effect.group.remove();
            removeLayerIfEmpty();
        }
        function start(element, options, onFinish) {
            if (active.has(element)) return true;
            if (!element.isConnected || root.document.hidden || active.size >= 4 || typeof element.animate !== 'function' || (options.respectReducedMotion && reducedMotion?.matches)) return false;
            const rect = element.getBoundingClientRect();
            const computed = root.getComputedStyle(element);
            if (rect.width < 4 || rect.height < 4 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= root.innerHeight || rect.left >= root.innerWidth || computed.display === 'none' || computed.visibility === 'hidden' || element.parentElement?.closest('[data-ytfc-hidden], [data-ytfc-dissolving]')) return false;
            const duration = ({ fast: 450, normal: 800, slow: 1200 })[options.animationSpeed] || 800;
            try {
                if (!layer) {
                    layer = root.document.createElement('div');
                    layer.setAttribute('data-ytfc-dust', '');
                    layer.setAttribute('aria-hidden', 'true');
                    layer.inert = true;
                    Object.assign(layer.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483646', overflow: 'hidden', contain: 'strict' });
                    shadow = layer.attachShadow({ mode: 'closed' });
                    root.document.documentElement.appendChild(layer);
                }
                const group = root.document.createElement('div');
                shadow.appendChild(group);
                const effect = { group, animations: [], timer: null };
                active.set(element, effect);
                element.setAttribute('data-ytfc-dissolving', '');
                const finish = () => {
                    if (active.get(element) !== effect) return;
                    cancel(element);
                    onFinish();
                };
                // Prefer thumbnail fragments, never copy interactive HTML or play media.
                const image = element.querySelector('a#thumbnail img, .yt-lockup-view-model__content-image img, img.yt-core-image') || element.querySelector('img');
                const imageRect = image?.getBoundingClientRect();
                const source = image?.currentSrc || image?.src || '';
                const imageURL = /^https?:\/\//i.test(source) && imageRect?.width > 4 && imageRect?.height > 4 ? source : '';
                const area = imageURL ? imageRect : rect;
                const left = Math.max(0, area.left), top = Math.max(0, area.top);
                const width = Math.min(area.right, root.innerWidth) - left;
                const height = Math.min(area.bottom, root.innerHeight) - top;
                if (width > 0 && height > 0) for (let row = 0; row < 6; row++) for (let col = 0; col < 8; col++) {
                    const particle = root.document.createElement('span');
                    const cellWidth = width / 8, cellHeight = height / 6;
                    const x = left + col * cellWidth, y = top + row * cellHeight;
                    Object.assign(particle.style, {
                        position: 'absolute', left: `${x}px`, top: `${y}px`, width: `${cellWidth * .8}px`, height: `${cellHeight * .8}px`,
                        borderRadius: '1px', opacity: '0', backgroundColor: ['#f5f5f5', '#aaaaaa', '#ff333d', '#646464'][(row + col) % 4],
                        ...(imageURL ? { backgroundImage: `url(${JSON.stringify(imageURL)})`, backgroundSize: `${area.width}px ${area.height}px`, backgroundPosition: `${area.left - x}px ${area.top - y}px` } : {})
                    });
                    group.appendChild(particle);
                    const spread = (row * 17 + col * 13) % 50;
                    effect.animations.push(particle.animate([
                        { opacity: 0, transform: 'translate(0, 0) scale(1)' },
                        { opacity: .9, transform: 'translate(0, 0) scale(.9)', offset: .12 },
                        { opacity: 0, transform: `translate(${45 + col * 8 + spread}px, ${-35 - row * 8 - spread}px) rotate(${spread * 4}deg) scale(.08)` }
                    ], { duration: duration * .65, delay: col / 8 * duration * .3, easing: 'ease-out', fill: 'forwards' }));
                }
                effect.animations.push(element.animate([
                    { opacity: 1, clipPath: 'inset(0 0 0 0)' },
                    { opacity: .7, clipPath: 'inset(0 0 0 45%)', offset: .45 },
                    { opacity: 0, clipPath: 'inset(0 0 0 100%)' }
                ], { duration, easing: 'ease-in', fill: 'forwards' }));
                // A timer also handles background throttling or a missing animation-finish event.
                effect.timer = root.setTimeout(finish, duration + 100);
                effect.animations.at(-1).onfinish = finish;
                return true;
            } catch {
                cancel(element);
                removeLayerIfEmpty();
                return false; // Visual failure must never prevent normal filtering.
            }
        }
        return { start, cancel, cancelAll() { for (const element of [...active.keys()]) cancel(element); }, size: () => active.size };
    }
    root.YTFCDust = { createController };
})(globalThis);

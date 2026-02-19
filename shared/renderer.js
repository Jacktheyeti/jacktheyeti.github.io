/**
 * Portfolio Renderer — Vanilla JS YAML/JSON → HTML
 * 
 * Loads a YAML or JSON config file and hydrates the page by rendering
 * content into placeholder elements. No build step, no framework.
 * 
 * Usage:
 *   <script src="../shared/renderer.js"></script>
 *   <script>
 *     PortfolioRenderer.init({ config: 'portfolio.yaml', page: 'home' });
 *   </script>
 */

const PortfolioRenderer = (() => {

    // ─── Tiny YAML Parser ───────────────────────────────────────────────
    // Handles a flat-to-nested YAML subset: scalars, lists, objects, 
    // list-of-objects. Sufficient for portfolio configs without a library.
    function parseYAML(text) {
        const lines = text.split('\n');
        return _parseBlock(lines, 0, -1).value;
    }

    function _getIndent(line) {
        const match = line.match(/^(\s*)/);
        return match ? match[1].length : 0;
    }

    function _parseBlock(lines, start, parentIndent) {
        const result = {};
        let i = start;

        while (i < lines.length) {
            const line = lines[i];
            const trimmed = line.trim();

            // Skip empty lines and comments
            if (!trimmed || trimmed.startsWith('#')) { i++; continue; }

            const indent = _getIndent(line);
            if (indent <= parentIndent) break;

            // List item
            if (trimmed.startsWith('- ')) {
                // We're in a list context — delegate to list parser
                const listResult = _parseList(lines, i, indent);
                // Find the key that owns this list by looking at the parent
                return { value: listResult.value, nextIndex: listResult.nextIndex };
            }

            // Key-value pair
            const kvMatch = trimmed.match(/^([^:]+?):\s*(.*)/);
            if (kvMatch) {
                const key = kvMatch[1].trim();
                let val = kvMatch[2].trim();

                if (val === '') {
                    // Check if next meaningful line is a list or nested object
                    let nextIdx = i + 1;
                    while (nextIdx < lines.length && !lines[nextIdx].trim()) nextIdx++;

                    if (nextIdx < lines.length) {
                        const nextIndent = _getIndent(lines[nextIdx]);
                        const nextTrimmed = lines[nextIdx].trim();

                        if (nextIndent > indent) {
                            if (nextTrimmed.startsWith('- ')) {
                                const listResult = _parseList(lines, nextIdx, nextIndent);
                                result[key] = listResult.value;
                                i = listResult.nextIndex;
                            } else {
                                const blockResult = _parseBlock(lines, nextIdx, indent);
                                result[key] = blockResult.value;
                                i = blockResult.nextIndex;
                            }
                        } else {
                            result[key] = '';
                            i++;
                        }
                    } else {
                        result[key] = '';
                        i++;
                    }
                } else {
                    // Inline value — strip quotes
                    result[key] = _parseScalar(val);
                    i++;
                }
            } else {
                i++;
            }
        }

        return { value: result, nextIndex: i };
    }

    function _parseList(lines, start, listIndent) {
        const result = [];
        let i = start;

        while (i < lines.length) {
            const line = lines[i];
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) { i++; continue; }

            const indent = _getIndent(line);
            if (indent < listIndent) break;
            if (indent > listIndent && !trimmed.startsWith('- ')) {
                // Continuation of previous list item (nested content)
                i++;
                continue;
            }

            if (trimmed.startsWith('- ')) {
                const itemContent = trimmed.slice(2).trim();

                // Check if this is a list of scalars or list of objects
                const kvMatch = itemContent.match(/^([^:]+?):\s*(.*)/);
                if (kvMatch) {
                    // List of objects — parse the object
                    const obj = {};
                    obj[kvMatch[1].trim()] = _parseScalar(kvMatch[2].trim());

                    // Check for more keys at deeper indent
                    let j = i + 1;
                    while (j < lines.length) {
                        const subLine = lines[j];
                        const subTrimmed = subLine.trim();
                        if (!subTrimmed || subTrimmed.startsWith('#')) { j++; continue; }
                        const subIndent = _getIndent(subLine);
                        if (subIndent <= indent) break;
                        if (subTrimmed.startsWith('- ')) break;

                        const subKv = subTrimmed.match(/^([^:]+?):\s*(.*)/);
                        if (subKv) {
                            const subKey = subKv[1].trim();
                            let subVal = subKv[2].trim();
                            if (subVal === '') {
                                // Nested list or object under list item
                                let nextJ = j + 1;
                                while (nextJ < lines.length && !lines[nextJ].trim()) nextJ++;
                                if (nextJ < lines.length && _getIndent(lines[nextJ]) > subIndent && lines[nextJ].trim().startsWith('- ')) {
                                    const nestedList = _parseList(lines, nextJ, _getIndent(lines[nextJ]));
                                    obj[subKey] = nestedList.value;
                                    j = nestedList.nextIndex;
                                    continue;
                                }
                                obj[subKey] = '';
                            } else {
                                obj[subKey] = _parseScalar(subVal);
                            }
                        }
                        j++;
                    }
                    result.push(obj);
                    i = j;
                } else {
                    // Simple scalar list item
                    result.push(_parseScalar(itemContent));
                    i++;
                }
            } else {
                break;
            }
        }

        return { value: result, nextIndex: i };
    }

    function _parseScalar(val) {
        if (val === 'true') return true;
        if (val === 'false') return false;
        if (val === 'null' || val === '~') return null;
        if (/^-?\d+$/.test(val)) return parseInt(val, 10);
        if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
        // Strip surrounding quotes
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            return val.slice(1, -1);
        }
        // Inline array: [a, b, c]
        if (val.startsWith('[') && val.endsWith(']')) {
            return val.slice(1, -1).split(',').map(s => _parseScalar(s.trim()));
        }
        return val;
    }

    // ─── Rendering Engine ───────────────────────────────────────────────

    function escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ─── Navigation ─────────────────────────────────────────────────────

    function renderNav(activePage, data) {
        const navEl = document.getElementById('site-nav');
        if (!navEl) return;

        const nav = (data && data.nav) || {};
        const links = nav.links || [
            { label: 'About', href: '/' },
            { label: 'Portfolio', href: '/portfolio/' }
        ];

        const linksHTML = links.map(link => {
            const active = link.label.toLowerCase() === (activePage || '').toLowerCase()
                ? ' site-nav__link--active' : '';
            return `<a href="${escapeHTML(link.href)}" class="site-nav__link${active}">${escapeHTML(link.label)}</a>`;
        }).join('');

        navEl.innerHTML = `
            <div class="site-nav__inner">
                <a href="/" class="site-nav__brand">JS</a>
                <div class="site-nav__links">${linksHTML}</div>
            </div>
        `;
    }

    function _renderCardGrid(items) {
        return items.map(item => {
            const tagsHTML = (item.tags || [])
                .map(t => `<span class="tag">${escapeHTML(t)}</span>`)
                .join('');
            return `
                <div class="card">
                    <div>
                        <h3>${escapeHTML(item.title || '')}</h3>
                        <div class="tags">${tagsHTML}</div>
                        <p>${escapeHTML(item.description || '')}</p>
                    </div>
                    <a href="${escapeHTML(item.link || '#')}" class="btn">${escapeHTML(item.link_label || 'View')}</a>
                </div>
            `;
        }).join('');
    }

    function renderHome(data) {
        const projects = data.projects || [];
        const footer = data.footer || {};

        // Navigation
        renderNav('portfolio', data);

        // Tag Filter
        const filterEl = document.getElementById('tag-filter');
        if (filterEl) {
            const allTags = [...new Set(projects.flatMap(p => p.tags || []))];
            filterEl.innerHTML = `
                <button class="tag-filter__btn tag-filter__btn--active" data-tag="all">All</button>
                ${allTags.map(tag => `<button class="tag-filter__btn" data-tag="${escapeHTML(tag)}">${escapeHTML(tag)}</button>`).join('')}
            `;

            filterEl.addEventListener('click', (e) => {
                const btn = e.target.closest('.tag-filter__btn');
                if (!btn) return;
                const tag = btn.dataset.tag;

                // Update active state
                filterEl.querySelectorAll('.tag-filter__btn').forEach(b => b.classList.remove('tag-filter__btn--active'));
                btn.classList.add('tag-filter__btn--active');

                // Filter cards
                const cards = document.querySelectorAll('#projects-grid .card');
                cards.forEach(card => {
                    if (tag === 'all') {
                        card.style.display = '';
                    } else {
                        const cardTags = (card.dataset.tags || '').split(',');
                        card.style.display = cardTags.includes(tag) ? '' : 'none';
                    }
                });
            });
        }

        // Projects Grid (unified)
        const gridEl = document.getElementById('projects-grid');
        if (gridEl) {
            gridEl.innerHTML = projects.map(item => {
                const tagsStr = (item.tags || []).join(',');
                const tagsHTML = (item.tags || [])
                    .map(t => `<span class="tag">${escapeHTML(t)}</span>`)
                    .join('');
                return `
                    <div class="card" data-tags="${escapeHTML(tagsStr)}">
                        <div>
                            <h3>${escapeHTML(item.title || '')}</h3>
                            <div class="tags">${tagsHTML}</div>
                            <p>${escapeHTML(item.description || '')}</p>
                        </div>
                        <a href="${escapeHTML(item.link || '#')}" class="btn">${escapeHTML(item.link_label || 'View')}</a>
                    </div>
                `;
            }).join('');
        }

        // Footer
        const footerEl = document.getElementById('site-footer');
        if (footerEl) {
            footerEl.innerHTML = `
                <p>${escapeHTML(footer.copyright || '')}</p>
                <p>${escapeHTML(footer.location || '')}</p>
            `;
        }
    }

    // ─── About Page ─────────────────────────────────────────────────────

    function renderAbout(data) {
        const profile = data.profile || {};
        const intro = data.intro || '';
        const accomplishments = data.accomplishments || [];
        const timeline = data.timeline || [];
        const footer = data.footer || {};

        // Navigation
        renderNav('about', data);

        // Profile Section
        const profileEl = document.getElementById('profile');
        if (profileEl) {
            const nameParts = (profile.name || '').split(' ');
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';

            const photoHTML = profile.photo
                ? `<img src="${escapeHTML(profile.photo)}" alt="${escapeHTML(profile.name)}" class="profile__photo">`
                : `<div class="profile__photo profile__photo--placeholder">${escapeHTML(firstName.charAt(0))}${escapeHTML(lastName.charAt(0))}</div>`;

            const credBadge = profile.credentials
                ? `<span class="profile__credential">${escapeHTML(profile.credentials)}</span>` : '';

            const locationHTML = profile.location
                ? `<div class="profile__location"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${escapeHTML(profile.location)}</div>` : '';

            let actionsHTML = '';
            if (profile.email) {
                actionsHTML += `<a href="mailto:${escapeHTML(profile.email)}" class="btn profile__btn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                    Contact
                </a>`;
            }
            if (profile.resume && profile.resume !== '#') {
                actionsHTML += `<a href="${escapeHTML(profile.resume)}" class="btn profile__btn" target="_blank" rel="noopener">View Resume</a>`;
            }
            if (profile.linkedin) {
                actionsHTML += `<a href="${escapeHTML(profile.linkedin)}" class="btn profile__btn" target="_blank" rel="noopener">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                    LinkedIn
                </a>`;
            }

            profileEl.innerHTML = `
                <div class="profile__inner">
                    ${photoHTML}
                    <div class="profile__content">
                        <h1 class="profile__name">${escapeHTML(firstName)} <span>${escapeHTML(lastName)}</span></h1>
                        <div class="profile__title">${escapeHTML(profile.title || '')} ${credBadge}</div>
                        ${profile.company ? `<div class="profile__company">${escapeHTML(profile.company)}</div>` : ''}
                        ${locationHTML}
                        <div class="profile__actions">${actionsHTML}</div>
                    </div>
                </div>
            `;
        }

        // Intro
        const introEl = document.getElementById('about-intro');
        if (introEl && intro) {
            introEl.innerHTML = `<p>${escapeHTML(intro)}</p>`;
        }

        // Accomplishments
        const accGrid = document.getElementById('accomplishments-grid');
        if (accGrid) {
            accGrid.innerHTML = accomplishments.map(acc => `
                <div class="accomplishment">
                    <span class="accomplishment__metric">${escapeHTML(acc.metric || '')}</span>
                    <span class="accomplishment__label">${escapeHTML(acc.label || '')}</span>
                    <span class="accomplishment__desc">${escapeHTML(acc.description || '')}</span>
                    <a href="${escapeHTML(acc.link || '#')}" class="accomplishment__link">${escapeHTML(acc.link_label || 'Review Project →')}</a>
                </div>
            `).join('');
        }

        // Timeline
        const timelineEl = document.getElementById('timeline');
        if (timelineEl) {
            timelineEl.innerHTML = timeline.map((entry, idx) => {
                const highlights = (entry.highlights || []).map(h =>
                    `<li>${escapeHTML(h)}</li>`
                ).join('');
                const side = idx % 2 === 0 ? 'timeline__entry--left' : 'timeline__entry--right';

                return `
                    <div class="timeline__entry ${side}" style="animation-delay: ${idx * 0.1}s">
                        <div class="timeline__marker"></div>
                        <div class="timeline__content">
                            <div class="timeline__date">${escapeHTML(entry.dates || '')}</div>
                            <h3 class="timeline__title">${escapeHTML(entry.title || '')}</h3>
                            ${entry.company ? `<div class="timeline__company">${escapeHTML(entry.company)}</div>` : ''}
                            ${entry.story ? `<p class="timeline__story">${escapeHTML(entry.story)}</p>` : ''}
                            ${highlights ? `<ul class="timeline__highlights">${highlights}</ul>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Footer
        const footerEl = document.getElementById('site-footer');
        if (footerEl) {
            footerEl.innerHTML = `
                <p>${escapeHTML(footer.copyright || '')}</p>
                <p>${escapeHTML(footer.location || '')}</p>
            `;
        }
    }

    function renderCurriculum(data) {
        const meta = data.module || {};
        const modules = data.modules || [];

        // Header
        const headerEl = document.getElementById('module-header');
        if (headerEl) {
            headerEl.innerHTML = `
                <h1>${escapeHTML(meta.title || '')}</h1>
                <p>${escapeHTML(meta.tagline || '')}</p>
            `;
        }

        // Back nav
        const navEl = document.getElementById('nav-back');
        if (navEl && meta.back_link) {
            navEl.href = meta.back_link;
        }

        // Module Cards
        const gridEl = document.getElementById('modules-grid');
        if (gridEl) {
            gridEl.innerHTML = modules.map(mod => {
                const lockedClass = mod.locked ? ' locked' : '';
                return `
                    <div class="module-card${lockedClass}">
                        <div class="module-card-header">
                            <span class="module-number">${escapeHTML(mod.id || '')}</span>
                            <span class="module-icon-text">${escapeHTML(mod.short_title || '')}</span>
                        </div>
                        <div class="module-card-body">
                            <div class="tags"><span class="tag tag--accent">${escapeHTML(mod.tag || '')}</span></div>
                            <div class="title">${escapeHTML(mod.tag || '')}</div>
                            <div class="desc">${escapeHTML(mod.card_desc || '')}</div>
                            <a href="module-${escapeHTML(mod.id)}-${escapeHTML(mod.slug || '')}.html" class="btn btn--filled">${mod.locked ? 'Coming Soon' : 'Start Module'}</a>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    function renderModuleDetail(data, moduleId) {
        const modules = data.modules || [];
        const mod = modules.find(m => m.id === moduleId);
        if (!mod) return;

        // Title
        const titleEl = document.getElementById('module-title');
        if (titleEl) {
            titleEl.textContent = `Module ${mod.id}: ${mod.title}`;
        }

        // Description
        const descEl = document.getElementById('module-description');
        if (descEl) {
            descEl.textContent = mod.description || '';
        }

        // Objectives
        const objEl = document.getElementById('module-objectives');
        if (objEl && mod.objectives) {
            objEl.innerHTML = mod.objectives.map(obj =>
                `<li><strong>${escapeHTML(obj.title || '')}:</strong> ${escapeHTML(obj.detail || '')}</li>`
            ).join('');
        }

        // Specs
        const specsEl = document.getElementById('module-specs');
        if (specsEl) {
            specsEl.innerHTML = `
                <p><strong>Duration:</strong> ${escapeHTML(mod.duration || 'TBD')}</p>
                <p><strong>Format:</strong> ${escapeHTML(mod.format || 'TBD')}</p>
                <p><strong>Engagement Rate:</strong> ${escapeHTML(mod.engagement || 'TBD')}</p>
            `;
        }

        // Iframe
        const iframeEl = document.getElementById('module-iframe');
        if (iframeEl && mod.iframe_src) {
            iframeEl.src = mod.iframe_src;
        }
    }

    function renderCaseStudy(data) {
        const meta = data.meta || {};
        const sections = data.sections || [];

        // Global nav
        renderNav(null, data);

        // Back nav
        const navEl = document.getElementById('cs-nav');
        if (navEl) {
            navEl.innerHTML = `<a href="${escapeHTML(meta.back_link || '../portfolio/')}" class="nav-back">${escapeHTML(meta.back_label || '← Back to Projects')}</a>`;
        }

        // Hero Image
        const heroImgEl = document.getElementById('cs-hero-image');
        if (heroImgEl && meta.hero_image) {
            heroImgEl.innerHTML = `<img src="${escapeHTML(meta.hero_image)}" alt="${escapeHTML(meta.title || '')}" class="cs-hero__img">`;
        }

        // Header
        const headerEl = document.getElementById('cs-header');
        if (headerEl) {
            headerEl.innerHTML = `
                <h1>${escapeHTML(meta.title || '')}</h1>
            `;
        }

        // Hero Statement
        const heroStmtEl = document.getElementById('cs-hero-statement');
        if (heroStmtEl && meta.hero_statement) {
            heroStmtEl.innerHTML = `<p>${escapeHTML(meta.hero_statement)}</p>`;
        }

        // Tags
        const tagsEl = document.getElementById('cs-tags');
        if (tagsEl && meta.tags) {
            const tags = meta.tags || [];
            tagsEl.innerHTML = tags.map(t => `<span class="tag tag--accent">${escapeHTML(t)}</span>`).join('');
        }

        // STAR Sections
        const starLabels = { situation: 'S', task: 'T', action: 'A', result: 'R' };
        const starNames = { situation: 'Situation', task: 'Task', action: 'Action', result: 'Result' };

        const bodyEl = document.getElementById('cs-body');
        if (bodyEl) {
            bodyEl.innerHTML = sections.map(section => {
                const paragraphs = (section.paragraphs || []).map(p => {
                    const cls = p.highlight ? ' case-study__paragraph--highlight' : '';
                    return `
                        <div class="case-study__paragraph${cls}">
                            <h3>${escapeHTML(p.heading || '')}</h3>
                            <p>${escapeHTML(p.body || '')}</p>
                        </div>
                    `;
                }).join('');

                const sectionId = (section.id || '').toLowerCase();
                const starLetter = starLabels[sectionId] || '';
                const starName = starNames[sectionId] || section.title || '';
                const displayTitle = starLetter ? section.title || starName : section.title || '';

                return `
                    <section class="case-study__section case-study__section--star" id="section-${escapeHTML(section.id || '')}">
                        ${starLetter ? `<div class="cs-star-label">${escapeHTML(starLetter)}</div>` : `<div class="case-study__phase">${escapeHTML(section.phase || '')}</div>`}
                        <h2>${escapeHTML(displayTitle)}</h2>
                        ${paragraphs}
                    </section>
                `;
            }).join('');
        }

        // Footer
        const footerEl = document.getElementById('site-footer');
        if (footerEl) {
            const footer = data.footer || {};
            footerEl.innerHTML = `
                <p>${escapeHTML(footer.copyright || '© 2026 Jack Schafer')}</p>
            `;
        }
    }

    // ─── Public API ─────────────────────────────────────────────────────

    async function init(options = {}) {
        const { config, page, moduleId } = options;
        if (!config) {
            console.error('[PortfolioRenderer] No config file specified.');
            return;
        }

        try {
            const response = await fetch(config);
            if (!response.ok) throw new Error(`Failed to load ${config}: ${response.status}`);
            const text = await response.text();

            let data;
            if (config.endsWith('.json')) {
                data = JSON.parse(text);
            } else {
                data = parseYAML(text);
            }

            switch (page) {
                case 'about':
                    renderAbout(data);
                    break;
                case 'home':
                    renderHome(data);
                    break;
                case 'curriculum':
                    renderCurriculum(data);
                    break;
                case 'module':
                    renderModuleDetail(data, moduleId);
                    break;
                case 'case-study':
                    renderCaseStudy(data);
                    break;
                default:
                    console.warn(`[PortfolioRenderer] Unknown page type: ${page}`);
            }
        } catch (err) {
            console.error('[PortfolioRenderer] Error:', err);
        }
    }

    return { init };
})();

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
        const site = data.site || {};
        const sections = data.sections || {};
        const initiatives = data.initiatives || [];
        const projects = data.projects || [];
        const footer = data.footer || {};

        // Header (no status badge)
        const headerEl = document.getElementById('site-header');
        if (headerEl) {
            const nameParts = (site.name || '').split(' ');
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';
            headerEl.innerHTML = `
                <div class="identity">
                    <h1>${escapeHTML(firstName)} <span>${escapeHTML(lastName)}</span></h1>
                    <div class="role">${escapeHTML(site.role || '')}</div>
                </div>
            `;
        }

        // Intro
        const introEl = document.getElementById('site-intro');
        if (introEl && site.intro) {
            introEl.innerHTML = `<p>${escapeHTML(site.intro)}</p>`;
        }

        // Section 1 Title
        const s1Title = document.getElementById('section1-title');
        if (s1Title && sections.section1) {
            s1Title.textContent = sections.section1;
        }

        // Section 1: Initiatives
        const initGrid = document.getElementById('initiatives-grid');
        if (initGrid) {
            initGrid.innerHTML = _renderCardGrid(initiatives);
        }

        // Section 2 Title
        const s2Title = document.getElementById('section2-title');
        if (s2Title && sections.section2) {
            s2Title.textContent = sections.section2;
        }

        // Section 2: Projects
        const gridEl = document.getElementById('projects-grid');
        if (gridEl) {
            gridEl.innerHTML = _renderCardGrid(projects);
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

        // Back nav
        const navEl = document.getElementById('cs-nav');
        if (navEl) {
            navEl.innerHTML = `<a href="${escapeHTML(meta.back_link || '../')}" class="nav-back">${escapeHTML(meta.back_label || '← Back')}</a>`;
        }

        // Header
        const headerEl = document.getElementById('cs-header');
        if (headerEl) {
            headerEl.innerHTML = `
                <h1>${escapeHTML(meta.title || '')}</h1>
                <p class="case-study__subtitle">${escapeHTML(meta.subtitle || '')}</p>
            `;
        }

        // Body sections
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

                return `
                    <section class="case-study__section" id="section-${escapeHTML(section.id || '')}">
                        <div class="case-study__phase">${escapeHTML(section.phase || '')}</div>
                        <h2>${escapeHTML(section.title || '')}</h2>
                        ${paragraphs}
                    </section>
                `;
            }).join('');
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

const state = {
    meteoData: null,
    currentCommune: null,
    currentMetric: 'temperature',
    currentMapMetric: 'all',
    compareMetric: 'temp_max',
    currentChart: null,
    comparisonChart: null,
    analyticsCharts: [],
    map: null,
    baseLayers: null,
    stationLayer: null,
    communeLayer: null,
    departmentLayer: null,
    stationMarkers: {},
    communeFeatureIndex: {},
    communeNameIndex: {},
    metricRanges: {},
    tableSort: { column: 'date', dir: 'desc' },
    tableSearch: '',
    currentTableData: [],
    monthGroups: [],
    selectedCommuneName: null,
    selectedCommuneKey: null,
    compareSelection: [],
    geojsonCache: {
        department: null,
        communes: null
    },
    spatial: {
        enabled: false,
        index: null,
        layer: null,
        cache: {},
        currentKey: null,
        communeGeoIndex: {},
        summaryCache: {},
        debounceId: null
    },
    heatLayer: null,
    heatmapEnabled: false,
    hoverRaf: null,
    ignoreMapClick: false
};

document.addEventListener('DOMContentLoaded', () => {
    if (window.ChartZoom) {
        Chart.register(window.ChartZoom);
    }
    setupEventListeners();
    loadData();
});

function setupEventListeners() {
    const communeSelect = document.getElementById('communeSelect');
    const metricSelect = document.getElementById('metricSelect');
    const mapMetricSelect = document.getElementById('mapMetricSelect');
    const compareMetric = document.getElementById('compareMetric');
    const compareBtn = document.getElementById('compareBtn');
    const compare1 = document.getElementById('compare1');
    const compare2 = document.getElementById('compare2');
    const spatialToggle = document.getElementById('spatialToggle');
    const spatialVariable = document.getElementById('spatialVariable');
    const spatialPeriod = document.getElementById('spatialPeriod');
    const heatmapToggle = document.getElementById('heatmapToggle');
    const searchInput = document.getElementById('searchTable');
    const exportBtn = document.getElementById('exportBtn');
    const legendToggle = document.getElementById('legendToggle');

    communeSelect.addEventListener('change', (event) => {
        const value = event.target.value;
        if (!value) {
            resetSelection();
            return;
        }
        selectCommune(value);
    });
    metricSelect.addEventListener('change', (event) => {
        state.currentMetric = event.target.value;
        if (state.currentCommune) {
            updateChart(state.meteoData.communes[state.currentCommune]);
        }
        updateHeatmap();
    });
    mapMetricSelect.addEventListener('change', (event) => {
        state.currentMapMetric = event.target.value;
        updateStationMarkers();
    });
    compareMetric.addEventListener('change', (event) => {
        state.compareMetric = event.target.value;
    });
    compare1.addEventListener('change', updateCompareSelection);
    compare2.addEventListener('change', updateCompareSelection);
    spatialToggle.addEventListener('change', handleSpatialToggle);
    spatialVariable.addEventListener('change', scheduleSpatialUpdate);
    spatialPeriod.addEventListener('change', scheduleSpatialUpdate);
    heatmapToggle.addEventListener('change', (event) => setHeatmapEnabled(event.target.checked));
    compareBtn.addEventListener('click', compareCommunes);
    searchInput.addEventListener('input', (event) => {
        state.tableSearch = event.target.value;
        renderTable();
    });
    exportBtn.addEventListener('click', exportToCSV);
    legendToggle.addEventListener('click', toggleLegendVisibility);

    document.querySelectorAll('#dataTable thead th').forEach((th) => {
        th.addEventListener('click', () => sortTable(th.dataset.column));
    });

    const tableBody = document.getElementById('tableBody');
    tableBody.addEventListener('click', (event) => handleTableToggle(event));

    updateHeatmapToggleLabel();
}

async function loadData() {
    try {
        const response = await fetch('meteo_data.json');
        if (!response.ok) {
            throw new Error('Unable to load JSON file.');
        }
        state.meteoData = await response.json();
        initializeDashboard();
    } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('communeSelect').innerHTML = '<option value="">Erreur de chargement</option>';
        document.getElementById('map').innerHTML = '<div class="map-error">Le fichier meteo_data.json est introuvable.</div>';
    }
}

function initializeDashboard() {
    displayMetadata();
    renderGlobalKpis();
    populateCommuneSelect();
    initializeMap();
    createAnalyticsCharts();
    loadSpatialIndex();

    const firstCommune = Object.keys(state.meteoData.communes)[0];
    if (firstCommune) {
        document.getElementById('communeSelect').value = firstCommune;
        selectCommune(firstCommune);
    }
}

function displayMetadata() {
    const metadata = state.meteoData.metadata;
    const stats = metadata.statistiques;

    document.getElementById('metadata').innerHTML = `
        <div><strong>Periode</strong>: ${stats.date_debut} au ${stats.date_fin}</div>
        <div><strong>Stations</strong>: ${stats.nb_communes} communes</div>
    `;
    document.getElementById('dateGeneration').textContent = metadata.date_generation;
}

function renderGlobalKpis() {
    const stats = state.meteoData.metadata.statistiques;
    const cards = [
        { label: 'Stations meteo', value: stats.nb_communes, sub: 'Departement 13' },
        { label: 'Record chaleur', value: `${stats.temp_max_globale.toFixed(1)} C`, sub: stats.commune_temp_max },
        { label: 'Record froid', value: `${stats.temp_min_globale.toFixed(1)} C`, sub: stats.commune_temp_min },
        { label: 'Precipitation max', value: `${stats.precip_max.toFixed(1)} mm`, sub: stats.commune_precip_max }
    ];

    const html = cards
        .map((card) => `
            <div class="kpi-card fade-up">
                <div class="kpi-label">${card.label}</div>
                <div class="kpi-value">${card.value}</div>
                <div class="kpi-sub">${card.sub}</div>
            </div>
        `)
        .join('');

    document.getElementById('statsCards').innerHTML = html;
}

function populateCommuneSelect() {
    const communes = Object.keys(state.meteoData.communes).sort();
    state.communeNameIndex = buildCommuneNameIndex(communes);
    const options = communes.map((commune) => `<option value="${commune}">${commune}</option>`).join('');

    document.getElementById('communeSelect').innerHTML = '<option value=\"\">Selectionner...</option>' + options;
    document.getElementById('compare1').innerHTML = '<option value="">Commune 1</option>' + options;
    document.getElementById('compare2').innerHTML = '<option value="">Commune 2</option>' + options;
}

function selectCommune(communeName) {
    const resolvedName = resolveCommuneName(communeName);
    const commune = state.meteoData.communes[resolvedName];
    if (!commune) return;

    state.currentCommune = resolvedName;
    showChartEmptyState(false);
    renderCommuneKpis(commune);
    updateChart(commune);
    updateTable(commune);
    updateMapSelection();
    focusOnCommune(resolvedName);
    updateSpatialSummary();
    updateHeatmap();
    animatePanel('communeKpis');
    animatePanel('meteoChart');
    animatePanel('comparisonChart');
    animatePanel('tableBody');
}

function renderCommuneKpis(commune) {
    const validTemps = commune.donnees.filter((d) => d.temp_moy !== null).map((d) => d.temp_moy);
    const avgTemp = validTemps.length ? validTemps.reduce((a, b) => a + b, 0) / validTemps.length : null;
    const totalPrecip = commune.donnees.reduce((sum, d) => sum + (d.precipitation || 0), 0);
    const maxWind = Math.max(...commune.donnees.map((d) => d.vent_max || 0));
    const lastDay = commune.donnees[commune.donnees.length - 1];

    const cards = [
        { label: 'Commune', value: commune.nom, sub: `Altitude ${commune.altitude} m` },
        { label: 'Temp moy', value: avgTemp !== null ? `${avgTemp.toFixed(1)} C` : 'N/A', sub: 'Moyenne periode' },
        { label: 'Total precip', value: `${totalPrecip.toFixed(1)} mm`, sub: 'Cumule periode' },
        { label: 'Vent max', value: `${maxWind.toFixed(1)} m/s`, sub: lastDay ? `Dernier jour ${lastDay.date}` : 'Dernier jour' }
    ];

    document.getElementById('communeKpis').innerHTML = cards
        .map((card) => `
            <div class="kpi-card fade-up">
                <div class="kpi-label">${card.label}</div>
                <div class="kpi-value">${card.value}</div>
                <div class="kpi-sub">${card.sub}</div>
            </div>
        `)
        .join('');
}

function initializeMap() {
    const bounds = state.meteoData.metadata.bounds;
    state.map = L.map('map', { zoomControl: true });

    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: 'OpenStreetMap contributors',
        maxZoom: 19
    });
    const carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: 'CartoDB Positron',
        maxZoom: 19
    });
    const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Esri World Imagery',
        maxZoom: 19
    });

    state.baseLayers = {
        'OpenStreetMap': osm,
        'CartoDB Positron': carto,
        'Esri World Imagery': esri
    };

    osm.addTo(state.map);
    L.control.layers(state.baseLayers, null, { position: 'topright' }).addTo(state.map);

    state.map.setView([bounds.center_lat, bounds.center_lon], 9);
    state.map.on('click', () => {
        if (state.ignoreMapClick) {
            state.ignoreMapClick = false;
            return;
        }
        resetSelection();
    });

    state.stationLayer = L.layerGroup().addTo(state.map);
    updateStationMarkers();
    showMapLoader(true);
    loadGeoJsonLayers().finally(() => showMapLoader(false));
    setTimeout(() => state.map.invalidateSize(), 50);

    if (L.heatLayer) {
        state.heatLayer = L.heatLayer(buildHeatData(), { radius: 25, blur: 15, maxZoom: 12 });
    }
}

function updateStationMarkers() {
    if (!state.stationLayer) return;

    state.stationLayer.clearLayers();
    state.stationMarkers = {};

    const metric = state.currentMapMetric;
    const range = getMetricRange(metric);
    updateMapLegend(metric, range);

    Object.entries(state.meteoData.communes).forEach(([nom, commune]) => {
        const value = getMetricValue(commune, metric);
        const color = metric === 'all' ? '#2f5bff' : interpolateColor(range.min, range.max, value, metric);
        const marker = L.circleMarker([commune.latitude, commune.longitude], {
            radius: 7,
            color: '#ffffff',
            weight: 1,
            fillColor: color,
            fillOpacity: 0.9
        }).addTo(state.stationLayer);

        marker.bindPopup(`
            <div style="min-width: 200px; font-family: 'Space Grotesk', sans-serif;">
                <strong>${nom}</strong><br>
                Altitude: ${commune.altitude} m<br>
                Poste: ${commune.num_poste}
            </div>
        `);

        marker.on('click', () => handleMapCommuneClick(nom));

        state.stationMarkers[nom] = marker;
    });

    if (!state.currentCommune) {
        const markerBounds = L.latLngBounds(Object.values(state.meteoData.communes).map((c) => [c.latitude, c.longitude]));
        state.map.fitBounds(markerBounds, { padding: [50, 50] });
    }
    updateMapSelection();
    updateHeatmap();
}

function updateMapLegend(metric, range) {
    if (state.spatial.layer && state.spatial.enabled) {
        return;
    }
    setMapLegendContent(stationLegendMarkup(metric, range));
}

function highlightMarker(communeName) {
    Object.values(state.stationMarkers).forEach((marker) => marker.setStyle({ fillOpacity: 0.35, radius: 6, color: '#ffffff' }));
    const marker = state.stationMarkers[communeName];
    if (marker) {
        marker.setStyle({ fillOpacity: 1, radius: 9, color: '#ff8a3d' });
    }
}

async function loadGeoJsonLayers() {
    proj4.defs('EPSG:2154', '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs');
    const targetCrs = 'EPSG:4326';

    let deptReprojected = state.geojsonCache.department;
    let communesReprojected = state.geojsonCache.communes;

    if (!deptReprojected || !communesReprojected) {
        const [deptRes, communeRes] = await Promise.all([
            fetch('data/raw/departement_13.geojson'),
            fetch('data/raw/communes_13.geojson')
        ]);

        if (!deptRes.ok || !communeRes.ok) {
            console.warn('GeoJSON layers not found.');
            return;
        }

        const departmentGeo = await deptRes.json();
        const communesGeo = await communeRes.json();

        deptReprojected = reprojectGeoJson(departmentGeo, 'EPSG:2154', targetCrs);
        communesReprojected = reprojectGeoJson(communesGeo, 'EPSG:2154', targetCrs);
        state.geojsonCache.department = deptReprojected;
        state.geojsonCache.communes = communesReprojected;
    }

    const canvasRenderer = L.canvas({ padding: 0.5 });

    state.departmentLayer = L.geoJSON(deptReprojected, {
        style: {
            color: '#1f3faa',
            weight: 3,
            fillOpacity: 0.05
        },
        renderer: canvasRenderer
    }).addTo(state.map);

    state.communeLayer = L.geoJSON(communesReprojected, {
        style: defaultCommuneStyle,
        renderer: canvasRenderer,
        onEachFeature: (feature, layer) => {
            const rawName = getCommuneName(feature);
            const matchedName = rawName ? resolveCommuneName(rawName) : null;
            const displayName = matchedName || rawName || 'Commune';
            if (displayName) {
                layer.bindPopup(`<strong>${displayName}</strong>`);
                state.communeFeatureIndex[normalizeName(displayName)] = layer;
                state.spatial.communeGeoIndex[normalizeName(displayName)] = {
                    geometry: feature.geometry,
                    bounds: computeGeometryBounds(feature.geometry)
                };
            }
            layer.on({
                click: () => {
                    if (displayName) {
                        handleMapCommuneClick(displayName);
                    }
                }
            });
        }
    }).addTo(state.map);
}

function getCommuneName(feature) {
    const props = feature.properties || {};
    return props.nom || props.NOM || props.name || props.NOM_USUEL || null;
}

function highlightFeature(event) {
    const layer = event.target;
    if (state.hoverRaf) cancelAnimationFrame(state.hoverRaf);
    state.hoverRaf = requestAnimationFrame(() => {
        layer.setStyle({
            weight: 2,
            color: '#ff8a3d',
            fillOpacity: 0.2
        });
    });
}

function resetFeature(event) {
    if (!state.communeLayer) return;
    if (state.hoverRaf) cancelAnimationFrame(state.hoverRaf);
    state.hoverRaf = requestAnimationFrame(() => {
        state.communeLayer.resetStyle(event.target);
        const name = getCommuneName(event.target.feature || {});
        const key = name ? normalizeName(name) : null;
        if (!key) return;
        if (isCompareMode()) {
            const [a, b] = state.compareSelection.map((item) => normalizeName(item));
            if (key === a) {
                event.target.setStyle(selectedCommuneStyle());
            } else if (key === b) {
                event.target.setStyle(selectedCommuneStyleAlt());
            } else {
                event.target.setStyle(dimCommuneStyle());
            }
            return;
        }
        if (key === state.selectedCommuneKey) {
            event.target.setStyle(selectedCommuneStyle());
        }
    });
}

function highlightCommunePolygon(communeName) {
    state.selectedCommuneName = communeName;
    state.selectedCommuneKey = communeName ? normalizeName(communeName) : null;
    updateMapSelection();
}

function reprojectGeoJson(geojson, sourceCrs, targetCrs) {
    const clone = JSON.parse(JSON.stringify(geojson));
    clone.features = clone.features.map((feature) => {
        feature.geometry.coordinates = reprojectCoords(feature.geometry.coordinates, sourceCrs, targetCrs);
        return feature;
    });
    return clone;
}

function reprojectCoords(coords, sourceCrs, targetCrs) {
    if (typeof coords[0] === 'number') {
        const projected = proj4(sourceCrs, targetCrs, coords);
        return [projected[0], projected[1]];
    }
    return coords.map((coord) => reprojectCoords(coord, sourceCrs, targetCrs));
}

function getMetricValue(commune, metric) {
    if (metric === 'all') return null;
    const last = commune.donnees[commune.donnees.length - 1];
    if (!last) return null;
    if (metric === 'temperature') return last.temp_moy ?? null;
    if (metric === 'precipitation') return last.precipitation ?? 0;
    if (metric === 'vent') return last.vent_max ?? null;
    return null;
}

function getCommuneHeatValue(commune) {
    const temps = commune.donnees.filter((d) => d.temp_moy !== null && d.temp_moy !== undefined).map((d) => d.temp_moy);
    if (!temps.length) return null;
    return temps.reduce((a, b) => a + b, 0) / temps.length;
}

function buildHeatData() {
    if (!state.meteoData) return [];
    return Object.values(state.meteoData.communes)
        .map((commune) => {
            const value = getCommuneHeatValue(commune);
            if (value === null || Number.isNaN(value)) return null;
            return [commune.latitude, commune.longitude, value];
        })
        .filter(Boolean);
}

function updateHeatmap() {
    if (!state.heatLayer) return;
    state.heatLayer.setLatLngs(buildHeatData());
}

function updateHeatmapToggleLabel() {
    const label = document.getElementById('heatmapToggleLabel');
    if (!label) return;
    label.textContent = state.heatmapEnabled ? 'Desactiver heatmap' : 'Activer heatmap';
}

function setHeatmapEnabled(enabled) {
    state.heatmapEnabled = enabled;
    updateHeatmapToggleLabel();
    if (!state.map || !state.heatLayer) return;
    if (enabled) {
        updateHeatmap();
        state.map.addLayer(state.heatLayer);
    } else {
        state.map.removeLayer(state.heatLayer);
    }
}

function getMetricRange(metric) {
    if (state.metricRanges[metric]) return state.metricRanges[metric];
    if (metric === 'all') return { min: 0, max: 1 };

    const values = Object.values(state.meteoData.communes)
        .map((commune) => getMetricValue(commune, metric))
        .filter((value) => value !== null && !Number.isNaN(value));

    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    state.metricRanges[metric] = { min, max };
    return { min, max };
}

function paletteForMetric(metric) {
    const palette = {
        temperature: ['#2f5bff', '#ff8a3d'],
        precipitation: ['#6b2cff', '#2f5bff'],
        vent: ['#ff8a3d', '#12b981']
    };
    return palette[metric] || palette.temperature;
}

function interpolateColor(min, max, value, metric) {
    if (value === null || value === undefined) return '#c8d0e0';
    const ratio = max === min ? 0.5 : (value - min) / (max - min);
    const [start, end] = paletteForMetric(metric);
    return blendColor(start, end, ratio);
}

function blendColor(start, end, ratio) {
    const s = hexToRgb(start);
    const e = hexToRgb(end);
    const r = Math.round(s.r + (e.r - s.r) * ratio);
    const g = Math.round(s.g + (e.g - s.g) * ratio);
    const b = Math.round(s.b + (e.b - s.b) * ratio);
    return `rgb(${r}, ${g}, ${b})`;
}

function hexToRgb(hex) {
    const raw = hex.replace('#', '');
    const bigint = parseInt(raw, 16);
    return {
        r: (bigint >> 16) & 255,
        g: (bigint >> 8) & 255,
        b: bigint & 255
    };
}

function metricLabel(metric) {
    const labels = {
        temperature: 'Temperature moyenne',
        precipitation: 'Precipitations',
        vent: 'Vent',
        temp_max: 'Temperature max',
        temp_moy: 'Temperature moyenne',
        temp_min: 'Temperature min',
        vent_max: 'Vent max',
        vent_moy: 'Vent moyen'
    };
    return labels[metric] || metric;
}

function createAnalyticsCharts() {
    const analyticsGrid = document.getElementById('analyticsGrid');
    analyticsGrid.innerHTML = `
        <div class="analytics-card">
            <h3>Temperatures moyennes</h3>
            <canvas id="tempMoyChart"></canvas>
        </div>
        <div class="analytics-card">
            <h3>Precipitations cumulees</h3>
            <canvas id="precipChart"></canvas>
        </div>
    `;

    const tempData = Object.entries(state.meteoData.communes)
        .map(([nom, data]) => {
            const temps = data.donnees.filter((d) => d.temp_moy !== null).map((d) => d.temp_moy);
            const avg = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : 0;
            return { commune: nom, value: avg };
        })
        .sort((a, b) => b.value - a.value);

    const precipData = Object.entries(state.meteoData.communes)
        .map(([nom, data]) => {
            const total = data.donnees.reduce((sum, d) => sum + (d.precipitation || 0), 0);
            return { commune: nom, value: total };
        })
        .sort((a, b) => b.value - a.value);

    state.analyticsCharts.forEach((chart) => chart.destroy());
    state.analyticsCharts = [];

    state.analyticsCharts.push(
        new Chart(document.getElementById('tempMoyChart'), {
            type: 'bar',
            data: {
                labels: tempData.map((d) => d.commune),
                datasets: [
                    {
                        label: 'Temp moyenne (C)',
                        data: tempData.map((d) => d.value.toFixed(1)),
                        backgroundColor: 'rgba(255, 138, 61, 0.5)',
                        borderColor: 'rgb(255, 138, 61)',
                        borderWidth: 1
                    }
                ]
            },
            options: chartCommonOptions('Temp moyenne (C)')
        })
    );

    state.analyticsCharts.push(
        new Chart(document.getElementById('precipChart'), {
            type: 'bar',
            data: {
                labels: precipData.map((d) => d.commune),
                datasets: [
                    {
                        label: 'Precipitations (mm)',
                        data: precipData.map((d) => d.value.toFixed(1)),
                        backgroundColor: 'rgba(47, 91, 255, 0.45)',
                        borderColor: 'rgb(47, 91, 255)',
                        borderWidth: 1
                    }
                ]
            },
            options: chartCommonOptions('Precipitations (mm)')
        })
    );
}

function chartCommonOptions(yLabel) {
    return {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
            legend: { display: false },
            tooltip: {
                callbacks: {
                    label: (context) => `${context.parsed.y.toFixed(1)} ${yLabel.includes('C') ? 'C' : 'mm'}`
                }
            },
            zoom: {
                pan: { enabled: true, mode: 'x' },
                zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                title: { display: true, text: yLabel }
            },
            x: {
                ticks: { maxRotation: 50, minRotation: 30 }
            }
        }
    };
}

function updateChart(commune) {
    const canvas = document.getElementById('meteoChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const labels = commune.donnees.map((d) => d.date);
    let datasets = [];
    const yScale = getChartYScale(commune, state.currentMetric);
    const isLineDraw = state.currentMetric !== 'precipitation';

    if (state.currentMetric === 'temperature') {
        datasets = [
            buildLineDataset('Temp max (C)', commune.donnees.map((d) => d.temp_max), '#ff5a3d'),
            buildLineDataset('Temp moy (C)', commune.donnees.map((d) => d.temp_moy), '#ff8a3d'),
            buildLineDataset('Temp min (C)', commune.donnees.map((d) => d.temp_min), '#2f5bff')
        ];
    } else if (state.currentMetric === 'precipitation') {
        datasets = [
            {
                label: 'Precipitations (mm)',
                data: commune.donnees.map((d) => d.precipitation),
                backgroundColor: 'rgba(47, 91, 255, 0.4)',
                borderColor: 'rgb(47, 91, 255)',
                borderWidth: 1,
                type: 'bar'
            }
        ];
    } else {
        datasets = [
            buildLineDataset('Vent max (m/s)', commune.donnees.map((d) => d.vent_max), '#ff8a3d'),
            buildLineDataset('Vent moy (m/s)', commune.donnees.map((d) => d.vent_moy), '#6b2cff')
        ];
    }

    const chartOptions = buildLocalChartOptions(commune, yScale, labels.length, isLineDraw);

    if (window.localChart && window.localChart.canvas !== canvas) {
        console.warn('[local-chart] canvas changed, destroying previous instance');
        window.localChart.destroy();
        window.localChart = null;
    }

    if (window.localChart) {
        console.info('[local-chart] update', { commune: commune.nom, metric: state.currentMetric });
        window.localChart.data.labels = labels;
        window.localChart.data.datasets = datasets;
        window.localChart.options = chartOptions;
        window.localChart.$localAnimating = true;
        window.localChart.update();
        state.currentChart = window.localChart;
        return;
    }

    console.info('[local-chart] create', { commune: commune.nom, metric: state.currentMetric });
    window.localChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: chartOptions
    });
    window.localChart.$localAnimating = true;
    state.currentChart = window.localChart;
}

function buildLineDataset(label, data, color) {
    return {
        label,
        data,
        borderColor: color,
        backgroundColor: color + '33',
        tension: 0.35,
        fill: true,
        spanGaps: true
    };
}

function updateTable(commune) {
    state.currentTableData = commune.donnees.slice();
    state.monthGroups = buildMonthlyGroups(state.currentTableData, state.tableSearch, state.monthGroups);
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('tableBody');
    state.monthGroups = buildMonthlyGroups(state.currentTableData, state.tableSearch, state.monthGroups);
    const grouped = sortMonthGroups(state.monthGroups, state.tableSort.column, state.tableSort.dir);

    tbody.innerHTML = grouped
        .map((group) => {
            const summary = group.summary;
            const rows = [];
            rows.push(`
                <tr class="month-row" data-month="${group.key}">
                    <td class="month-cell">
                        <button class="month-toggle" data-month="${group.key}" aria-expanded="${group.expanded ? 'true' : 'false'}">
                            ${group.expanded ? '▼' : '▶'}
                        </button>
                        <span class="month-label">${group.label}</span>
                    </td>
                    <td>${formatValue(summary.temp_min, 1)}</td>
                    <td>${formatValue(summary.temp_max, 1)}</td>
                    <td>${formatValue(summary.temp_moy, 1)}</td>
                    <td>${formatValue(summary.precipitation, 1)}</td>
                    <td>${formatValue(summary.vent_moy, 1)}</td>
                    <td>${formatValue(summary.vent_max, 1)}</td>
                </tr>
            `);

            if (group.expanded) {
                group.days.forEach((jour) => {
                    const tempMin = jour.temp_min !== null ? `<span class="${jour.temp_min < 5 ? 'temp-cold' : ''}">${jour.temp_min.toFixed(1)}</span>` : '-';
                    const tempMax = jour.temp_max !== null ? `<span class="${jour.temp_max > 25 ? 'temp-hot' : ''}">${jour.temp_max.toFixed(1)}</span>` : '-';
                    const tempMoy = jour.temp_moy !== null ? jour.temp_moy.toFixed(1) : '-';
                    const precip = jour.precipitation !== null ? `<span class="${jour.precipitation > 10 ? 'precip-high' : ''}">${jour.precipitation.toFixed(1)}</span>` : '-';
                    const ventMoy = jour.vent_moy !== null ? jour.vent_moy.toFixed(1) : '-';
                    const ventMax = jour.vent_max !== null ? `<span class="${jour.vent_max > 10 ? 'wind-high' : ''}">${jour.vent_max.toFixed(1)}</span>` : '-';

                    rows.push(`
                        <tr class="day-row" data-month="${group.key}">
                            <td class="day-cell">${jour.date}</td>
                            <td>${tempMin}</td>
                            <td>${tempMax}</td>
                            <td>${tempMoy}</td>
                            <td>${precip}</td>
                            <td>${ventMoy}</td>
                            <td>${ventMax}</td>
                        </tr>
                    `);
                });
            }

            return rows.join('');
        })
        .join('');
}

function sortTable(column) {
    if (state.tableSort.column === column) {
        state.tableSort.dir = state.tableSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        state.tableSort.column = column;
        state.tableSort.dir = 'asc';
    }
    renderTable();
}

function sortRows(rows, column, direction) {
    const sorted = rows.slice().sort((a, b) => {
        const aVal = a[column];
        const bVal = b[column];
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;
        if (column === 'date') {
            return parseDate(aVal) - parseDate(bVal);
        }
        return aVal - bVal;
    });
    return direction === 'asc' ? sorted : sorted.reverse();
}

function parseDate(dateString) {
    const parts = dateString.split('/');
    if (parts.length !== 3) return new Date(dateString);
    return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
}

function getChartYScale(commune, metric) {
    let values = [];
    if (metric === 'temperature') {
        values = commune.donnees.flatMap((d) => [d.temp_min, d.temp_moy, d.temp_max]);
    } else if (metric === 'precipitation') {
        values = commune.donnees.map((d) => d.precipitation);
    } else {
        values = commune.donnees.flatMap((d) => [d.vent_moy, d.vent_max]);
    }
    const valid = values.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
    if (!valid.length) return { min: 0, max: 1 };
    const min = Math.min(...valid);
    const max = Math.max(...valid);
    const padding = Math.max((max - min) * 0.08, 1);
    const baseMin = metric === 'precipitation' ? 0 : min - padding;
    return { min: baseMin, max: max + padding };
}

function buildLocalChartOptions(commune, yScale, labelCount, isLineDraw) {
    const totalDuration = 1000;
    const delayBetweenPoints = labelCount ? totalDuration / labelCount : totalDuration;
    const animation = {
        duration: totalDuration,
        easing: 'easeOutQuart',
        onComplete: (animationContext) => {
            const chart = animationContext.chart;
            if (!chart || !chart.$localAnimating) return;
            chart.$localAnimating = false;
            chart.options.animation = false;
            chart.options.animations = false;
            chart.options.transitions = {
                active: { animation: { duration: 0 } },
                resize: { animation: { duration: 0 } },
                show: { animation: { duration: 0 } },
                hide: { animation: { duration: 0 } }
            };
            chart.update('none');
        }
    };
    const animations = isLineDraw ? buildLineDrawAnimations(delayBetweenPoints) : {};

    return {
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 0,
        animation,
        animations,
        plugins: {
            legend: {
                display: true,
                position: 'top',
                labels: { font: { size: 12, weight: '600' } }
            },
            tooltip: { mode: 'index', intersect: false },
            zoom: {
                pan: { enabled: true, mode: 'x' },
                zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }
            },
            title: {
                display: true,
                text: `${commune.nom} - ${metricLabel(state.currentMetric)}`
            }
        },
        interaction: {
            mode: 'index',
            intersect: false
        },
        transitions: {
            active: { animation: { duration: 0 } },
            resize: { animation: { duration: 0 } },
            show: { animation: { duration: 0 } },
            hide: { animation: { duration: 0 } }
        },
        elements: {
            line: { borderWidth: 2 },
            point: { radius: 2, hoverRadius: 4, hitRadius: 6 }
        },
        scales: {
            y: {
                beginAtZero: state.currentMetric === 'precipitation',
                suggestedMin: yScale.min,
                suggestedMax: yScale.max,
                ticks: { font: { size: 11 } }
            },
            x: {
                ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 0, autoSkip: true }
            }
        }
    };
}

function buildLineDrawAnimations(delayBetweenPoints) {
    const previousY = (ctx) => {
        if (!ctx.chart || !ctx.chart.scales || !ctx.chart.scales.y) return 0;
        const scale = ctx.chart.scales.y;
        if (ctx.index === 0) {
            return scale.getPixelForValue(scale.min ?? 0);
        }
        const meta = ctx.chart.getDatasetMeta(ctx.datasetIndex);
        const prev = meta?.data?.[ctx.index - 1];
        if (!prev) {
            return scale.getPixelForValue(scale.min ?? 0);
        }
        return prev.getProps(['y'], true).y;
    };

    return {
        x: {
            type: 'number',
            easing: 'linear',
            duration: delayBetweenPoints,
            from: NaN,
            delay: (ctx) => {
                if (ctx.type !== 'data' || ctx.xStarted) return 0;
                ctx.xStarted = true;
                return ctx.dataIndex * delayBetweenPoints;
            }
        },
        y: {
            type: 'number',
            easing: 'linear',
            duration: delayBetweenPoints,
            from: previousY,
            delay: (ctx) => {
                if (ctx.type !== 'data' || ctx.yStarted) return 0;
                ctx.yStarted = true;
                return ctx.dataIndex * delayBetweenPoints;
            }
        }
    };
}

function buildCommuneNameIndex(communes) {
    const index = {};
    communes.forEach((name) => {
        index[normalizeName(name)] = name;
    });
    return index;
}

function resolveCommuneName(name) {
    if (!name) return name;
    const normalized = normalizeName(name);
    return state.communeNameIndex[normalized] || name;
}

function normalizeName(name) {
    return name
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[-']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
}

function selectCommuneFromMap(communeName) {
    const resolved = resolveCommuneName(communeName);
    const select = document.getElementById('communeSelect');
    select.value = resolved;
    selectCommune(resolved);
}

function handleMapCommuneClick(communeName) {
    state.ignoreMapClick = true;
    const resolved = resolveCommuneName(communeName);
    if (isCompareMode() && !state.compareSelection.includes(resolved)) {
        return;
    }
    selectCommuneFromMap(resolved);
}

function focusOnCommune(communeName) {
    if (!state.map) return;
    const key = normalizeName(communeName);
    const layer = state.communeFeatureIndex[key];
    if (layer && layer.getBounds) {
        state.map.fitBounds(layer.getBounds(), { padding: [40, 40], animate: true, duration: 0.8 });
        return;
    }
    const marker = state.stationMarkers[communeName];
    if (marker) {
        state.map.flyTo(marker.getLatLng(), 11, { animate: true, duration: 0.8 });
    }
}

function defaultCommuneStyle() {
    return {
        color: '#6b2cff',
        weight: 1,
        fillColor: '#6b2cff',
        fillOpacity: 0.05
    };
}

function dimCommuneStyle() {
    return {
        color: '#6b2cff',
        weight: 1,
        fillColor: '#6b2cff',
        fillOpacity: 0.02
    };
}

function selectedCommuneStyle() {
    return {
        weight: 3,
        color: '#ff8a3d',
        fillColor: '#ff8a3d',
        fillOpacity: 0.25
    };
}

function selectedCommuneStyleAlt() {
    return {
        weight: 3,
        color: '#2f5bff',
        fillColor: '#2f5bff',
        fillOpacity: 0.22
    };
}

function updateCompareSelection() {
    const compare1 = document.getElementById('compare1').value;
    const compare2 = document.getElementById('compare2').value;
    state.compareSelection = [compare1, compare2].filter(Boolean);

    if (isCompareMode() && !state.compareSelection.includes(state.currentCommune)) {
        document.getElementById('communeSelect').value = state.compareSelection[0];
        selectCommune(state.compareSelection[0]);
        return;
    }
    updateMapSelection();
}

function isCompareMode() {
    return state.compareSelection.length === 2;
}

function updateMapSelection() {
    if (!state.map) return;

    if (isCompareMode()) {
        applyCompareStyles(state.compareSelection[0], state.compareSelection[1]);
        return;
    }

    if (state.currentCommune) {
        applySingleSelection(state.currentCommune);
        return;
    }

    resetMapStyles();
}

function applySingleSelection(communeName) {
    highlightMarker(communeName);
    if (!state.communeLayer) return;
    const targetKey = normalizeName(communeName);
    state.selectedCommuneKey = targetKey;
    state.communeLayer.eachLayer((layer) => {
        const layerName = getCommuneName(layer.feature || {});
        const layerKey = layerName ? normalizeName(layerName) : null;
        if (layerKey && layerKey === targetKey) {
            layer.setStyle(selectedCommuneStyle());
        } else {
            layer.setStyle(dimCommuneStyle());
        }
    });
}

function applyCompareStyles(communeA, communeB) {
    const keyA = normalizeName(communeA);
    const keyB = normalizeName(communeB);
    if (state.communeLayer) {
        state.communeLayer.eachLayer((layer) => {
            const layerName = getCommuneName(layer.feature || {});
            const layerKey = layerName ? normalizeName(layerName) : null;
            if (layerKey === keyA) {
                layer.setStyle(selectedCommuneStyle());
            } else if (layerKey === keyB) {
                layer.setStyle(selectedCommuneStyleAlt());
            } else {
                layer.setStyle(dimCommuneStyle());
            }
        });
    }

    Object.entries(state.stationMarkers).forEach(([name, marker]) => {
        if (name === communeA) {
            marker.setStyle({ fillOpacity: 1, radius: 9, color: '#ff8a3d' });
        } else if (name === communeB) {
            marker.setStyle({ fillOpacity: 1, radius: 9, color: '#2f5bff' });
        } else {
            marker.setStyle({ fillOpacity: 0.25, radius: 6, color: '#ffffff' });
        }
    });
}

function resetMapStyles() {
    state.selectedCommuneKey = null;
    if (state.communeLayer) {
        state.communeLayer.eachLayer((layer) => layer.setStyle(defaultCommuneStyle()));
    }
    Object.values(state.stationMarkers).forEach((marker) => marker.setStyle({ fillOpacity: 0.75, radius: 7, color: '#ffffff' }));
}

function resetSelection() {
    state.currentCommune = null;
    state.selectedCommuneName = null;
    state.selectedCommuneKey = null;
    state.compareSelection = [];
    document.getElementById('communeSelect').value = '';
    document.getElementById('compare1').value = '';
    document.getElementById('compare2').value = '';
    clearCommunePanels();
    resetMapStyles();
    updateSpatialSummary();
}

function clearCommunePanels() {
    const kpis = document.getElementById('communeKpis');
    kpis.innerHTML = `
        <div class="kpi-card fade-up">
            <div class="kpi-label">Commune</div>
            <div class="kpi-value">Selectionner...</div>
            <div class="kpi-sub">Clique sur la carte ou le menu.</div>
        </div>
    `;

    if (state.currentChart) {
        console.info('[local-chart] destroy');
        state.currentChart.destroy();
        state.currentChart = null;
        window.localChart = null;
    }
    showChartEmptyState(true);
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '';
}

function showChartEmptyState(isVisible) {
    const canvas = document.getElementById('meteoChart');
    if (!canvas) return;
    const wrapper = canvas.parentElement;
    if (!wrapper) return;
    let empty = wrapper.querySelector('.chart-empty');
    if (!empty) {
        empty = document.createElement('div');
        empty.className = 'chart-empty';
        empty.textContent = 'Aucune commune selectionnee';
        wrapper.appendChild(empty);
    }
    empty.classList.toggle('hidden', !isVisible);
}

function showMapLoader(isVisible, message) {
    const loader = document.getElementById('mapLoader');
    if (!loader) return;
    if (message) {
        loader.textContent = message;
    }
    loader.classList.toggle('hidden', !isVisible);
}


function updateStationLegend() {
    const metric = state.currentMapMetric;
    const range = getMetricRange(metric);
    setMapLegendContent(stationLegendMarkup(metric, range));
}

function stationLegendMarkup(metric, range) {
    if (metric === 'all') {
        return `
            <div class="legend-scale">
                <span>Stations</span>
                <span class="legend-meta">Couleur fixe</span>
            </div>
            <div class="legend-meta">Choisir une variable pour activer la couleur dynamique.</div>
        `;
    }
    const [start, end] = paletteForMetric(metric);
    return `
        <div class="legend-scale">
            <span>${metricLabel(metric)}</span>
            <span class="legend-bar" style="background: linear-gradient(90deg, ${start}, ${end});"></span>
            <span class="legend-meta">${range.min.toFixed(1)} -> ${range.max.toFixed(1)}</span>
        </div>
        <div class="legend-meta">Dernier jour dispo | Survol des communes pour details</div>
    `;
}

function setMapLegendContent(html) {
    const legendContent = document.getElementById('legendContent');
    if (!legendContent) return;
    legendContent.innerHTML = html;
}

async function loadSpatialIndex() {
    try {
        const response = await fetch('outputs/spatial/index.json');
        if (!response.ok) {
            throw new Error('index missing');
        }
        state.spatial.index = await response.json();
    } catch (error) {
        console.warn('Spatial index not available:', error);
        state.spatial.index = null;
    }
    updateSpatialControlsAvailability();
}

function updateSpatialControlsAvailability() {
    const toggle = document.getElementById('spatialToggle');
    const label = document.getElementById('spatialToggleLabel');
    const variableSelect = document.getElementById('spatialVariable');
    const periodSelect = document.getElementById('spatialPeriod');
    const hasLayers = Boolean(state.spatial.index?.layers?.length);

    toggle.disabled = !hasLayers;
    variableSelect.disabled = !hasLayers;
    periodSelect.disabled = !hasLayers;

    if (!hasLayers) {
        toggle.checked = false;
        state.spatial.enabled = false;
        label.textContent = 'OFF';
        clearSpatialLayer();
        updateSpatialSummary('Aucune couche spatiale disponible.');
        updateStationLegend();
        return;
    }

    updateSpatialToggleLabel();
    scheduleSpatialUpdate();
}

function handleSpatialToggle(event) {
    state.spatial.enabled = event.target.checked;
    updateSpatialToggleLabel();
    scheduleSpatialUpdate();
}

function updateSpatialToggleLabel() {
    const label = document.getElementById('spatialToggleLabel');
    if (!label) return;
    label.textContent = state.spatial.enabled ? 'ON' : 'OFF';
}

function scheduleSpatialUpdate() {
    if (state.spatial.debounceId) {
        clearTimeout(state.spatial.debounceId);
    }
    state.spatial.debounceId = setTimeout(() => {
        applySpatialLayer();
    }, 220);
    updateHeatmap();
}

function applySpatialLayer() {
    if (!state.spatial.enabled) {
        clearSpatialLayer();
        updateStationLegend();
        updateSpatialSummary();
        return;
    }

    if (!state.spatial.index?.layers?.length) {
        clearSpatialLayer();
        updateSpatialSummary('Aucune couche spatiale disponible.');
        return;
    }

    const variable = document.getElementById('spatialVariable').value;
    const periodType = document.getElementById('spatialPeriod').value;
    const record = pickSpatialRecord(variable, periodType);
    if (!record) {
        clearSpatialLayer();
        updateSpatialSummary('Aucune periode disponible pour cette variable.');
        return;
    }
    showSpatialLayer(record);
}

function pickSpatialRecord(variable, periodType) {
    const candidates = state.spatial.index.layers.filter(
        (item) => item.variable === variable && item.period_type === periodType
    );
    if (!candidates.length) return null;
    const sorted = candidates.slice().sort((a, b) => parseSpatialPeriod(a) - parseSpatialPeriod(b));
    return sorted[sorted.length - 1];
}

function parseSpatialPeriod(record) {
    if (record.period_type === 'month') {
        return parseInt(record.period.replace('-', ''), 10);
    }
    return parseInt(record.period, 10);
}

function showSpatialLayer(record) {
    const key = `${record.variable}:${record.period_type}:${record.period}`;
    if (state.spatial.currentKey === key && state.spatial.layer) {
        updateSpatialLegend(record);
        updateSpatialSummary();
        return;
    }

    clearSpatialLayer();
    state.spatial.currentKey = key;

    const cached = state.spatial.cache[key];
    if (cached) {
        state.spatial.layer = cached.layer;
        state.spatial.layer.addTo(state.map);
        bringSpatialLayersToFront();
        updateSpatialLegend(record, cached.stats);
        updateSpatialSummary();
        return;
    }

    const geojsonPath = normalizeSpatialPath(record.geojson);
    showMapLoader(true, 'Chargement analyse spatiale...');
    fetch(geojsonPath)
        .then((response) => response.json())
        .then((geojson) => {
            const layerData = buildSpatialLayer(geojson, record);
            state.spatial.cache[key] = layerData;
            state.spatial.layer = layerData.layer;
            layerData.layer.addTo(state.map);
            bringSpatialLayersToFront();
            updateSpatialLegend(record, layerData.stats);
            updateSpatialSummary();
        })
        .catch((error) => console.warn('Spatial layer load error:', error))
        .finally(() => showMapLoader(false));
}

function bringSpatialLayersToFront() {
    if (state.stationLayer) state.stationLayer.bringToFront();
    if (state.departmentLayer) state.departmentLayer.bringToFront();
    if (state.communeLayer) state.communeLayer.bringToFront();
}

function buildSpatialLayer(geojson, record) {
    const points = extractSpatialPoints(geojson);
    const stats = buildSpatialStats(points, record.stats);
    const renderer = L.canvas({ padding: 0.5 });
    const paletteMetric = record.variable === 'temperature' ? 'temperature' : record.variable;
    const layer = L.geoJSON(geojson, {
        renderer,
        pointToLayer: (feature, latlng) => {
            const value = feature.properties?.value ?? 0;
            const color = interpolateColor(stats.min, stats.max, value, paletteMetric);
            return L.circleMarker(latlng, {
                radius: 3,
                weight: 0,
                fillColor: color,
                fillOpacity: 0.8
            });
        }
    });
    return { layer, points, stats, record };
}

function extractSpatialPoints(geojson) {
    return (geojson.features || [])
        .map((feature) => {
            const coords = feature.geometry?.coordinates || [];
            return {
                lon: coords[0],
                lat: coords[1],
                value: Number(feature.properties?.value)
            };
        })
        .filter((point) => Number.isFinite(point.value));
}

function buildSpatialStats(points, fallback) {
    if (fallback && Number.isFinite(fallback.min) && Number.isFinite(fallback.max)) {
        return fallback;
    }
    if (!points.length) {
        return { min: 0, max: 1 };
    }
    const values = points.map((p) => p.value);
    return { min: Math.min(...values), max: Math.max(...values) };
}

function clearSpatialLayer() {
    if (state.spatial.layer) {
        state.map.removeLayer(state.spatial.layer);
    }
    state.spatial.layer = null;
    state.spatial.currentKey = null;
}

function updateSpatialLegend(record, statsOverride) {
    const stats = statsOverride || record.stats || { min: 0, max: 1 };
    const label = metricLabel(record.variable);
    const [start, end] = paletteForMetric(record.variable === 'temperature' ? 'temperature' : record.variable);
    setMapLegendContent(`
        <div class="legend-scale">
            <span>${label}</span>
            <span class="legend-bar" style="background: linear-gradient(90deg, ${start}, ${end});"></span>
            <span class="legend-meta">${stats.min.toFixed(1)} -> ${stats.max.toFixed(1)}</span>
        </div>
        <div class="legend-meta">${record.period_type === 'month' ? 'Mois' : 'Jour'}: ${record.period}</div>
    `);
}

function toggleLegendVisibility() {
    const legend = document.getElementById('mapLegend');
    const button = document.getElementById('legendToggle');
    if (!legend || !button) return;
    legend.classList.toggle('collapsed');
    button.textContent = legend.classList.contains('collapsed') ? 'Afficher' : 'Masquer';
}

function updateSpatialSummary(message) {
    const container = document.getElementById('spatialSummary');
    if (!container) return;
    const body = container.querySelector('.summary-body');
    if (!body) return;

    if (message) {
        body.textContent = message;
        return;
    }

    if (!state.spatial.enabled) {
        body.textContent = 'Analyse spatiale desactivee.';
        return;
    }

    if (!state.currentCommune) {
        body.textContent = 'Selectionne une commune pour obtenir une valeur.';
        return;
    }

    if (!state.spatial.currentKey) {
        body.textContent = 'Aucune couche spatiale chargee.';
        return;
    }

    const cache = state.spatial.cache[state.spatial.currentKey];
    if (!cache) {
        body.textContent = 'Chargement des valeurs spatiales...';
        return;
    }

    const communeKey = state.selectedCommuneKey || normalizeName(state.currentCommune);
    const summaryKey = `${state.spatial.currentKey}:${communeKey}`;
    const cachedSummary = state.spatial.summaryCache[summaryKey];
    if (cachedSummary) {
        body.innerHTML = cachedSummary;
        return;
    }

    const summary = computeSpatialSummary(state.currentCommune, cache);
    if (!summary) {
        body.textContent = 'Aucune valeur spatiale disponible pour cette commune.';
        return;
    }

    const label = metricLabel(cache.record?.variable || document.getElementById('spatialVariable').value);
    const html = `<strong>${label}</strong>: ${summary.value.toFixed(2)} (${summary.method})`;
    state.spatial.summaryCache[summaryKey] = html;
    body.innerHTML = html;
}

function computeSpatialSummary(communeName, layerData) {
    const key = normalizeName(communeName);
    const target = state.spatial.communeGeoIndex[key];
    if (!target || !layerData.points.length) {
        return null;
    }

    const bounds = target.bounds;
    let sum = 0;
    let count = 0;
    layerData.points.forEach((point) => {
        if (
            point.lon < bounds.minLon ||
            point.lon > bounds.maxLon ||
            point.lat < bounds.minLat ||
            point.lat > bounds.maxLat
        ) {
            return;
        }
        if (pointInGeometry(point, target.geometry)) {
            sum += point.value;
            count += 1;
        }
    });

    if (count > 0) {
        return { value: sum / count, method: 'moyenne commune' };
    }

    const center = {
        lon: (bounds.minLon + bounds.maxLon) / 2,
        lat: (bounds.minLat + bounds.maxLat) / 2
    };
    let nearest = null;
    let nearestDist = Infinity;
    layerData.points.forEach((point) => {
        const dist = Math.pow(point.lon - center.lon, 2) + Math.pow(point.lat - center.lat, 2);
        if (dist < nearestDist) {
            nearestDist = dist;
            nearest = point;
        }
    });
    if (!nearest) return null;
    return { value: nearest.value, method: 'valeur au centre' };
}

function computeGeometryBounds(geometry) {
    const bounds = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
    walkGeometryCoords(geometry, (lon, lat) => {
        bounds.minLon = Math.min(bounds.minLon, lon);
        bounds.minLat = Math.min(bounds.minLat, lat);
        bounds.maxLon = Math.max(bounds.maxLon, lon);
        bounds.maxLat = Math.max(bounds.maxLat, lat);
    });
    return bounds;
}

function walkGeometryCoords(geometry, cb) {
    if (!geometry) return;
    const { type, coordinates } = geometry;
    if (type === 'Polygon') {
        coordinates.forEach((ring) => ring.forEach(([lon, lat]) => cb(lon, lat)));
        return;
    }
    if (type === 'MultiPolygon') {
        coordinates.forEach((poly) => poly.forEach((ring) => ring.forEach(([lon, lat]) => cb(lon, lat))));
    }
}

function pointInGeometry(point, geometry) {
    if (!geometry) return false;
    if (geometry.type === 'Polygon') {
        return pointInPolygon(point, geometry.coordinates);
    }
    if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
    }
    return false;
}

function pointInPolygon(point, polygon) {
    if (!polygon.length) return false;
    const [outer, ...holes] = polygon;
    if (!pointInRing(point, outer)) return false;
    return !holes.some((ring) => pointInRing(point, ring));
}

function pointInRing(point, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0];
        const yi = ring[i][1];
        const xj = ring[j][0];
        const yj = ring[j][1];
        const intersect =
            (yi > point.lat) !== (yj > point.lat) &&
            point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi + 0.0) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}


function normalizeSpatialPath(pathValue) {
    if (!pathValue) return '';
    if (pathValue.startsWith('outputs/')) {
        return pathValue;
    }
    if (pathValue.startsWith('..')) {
        return pathValue;
    }
    return pathValue;
}

function buildMonthlyGroups(rows, searchValue, existingGroups) {
    const filtered = filterRows(rows, searchValue);
    const months = {};
    const expandedMap = {};
    (existingGroups || []).forEach((group) => {
        expandedMap[group.key] = group.expanded;
    });

    filtered.forEach((row) => {
        const date = parseDate(row.date);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!months[key]) {
            months[key] = {
                key,
                label: `${monthName(date.getMonth())} ${date.getFullYear()}`,
                days: [],
                expanded: searchValue ? true : Boolean(expandedMap[key])
            };
        }
        months[key].days.push(row);
    });

    return Object.values(months).map((group) => {
        group.days.sort((a, b) => parseDate(a.date) - parseDate(b.date));
        group.summary = summarizeMonth(group.days);
        return group;
    });
}

function filterRows(rows, searchValue) {
    if (!searchValue) return rows.slice();
    const search = searchValue.toLowerCase();
    return rows.filter((row) => {
        return [
            row.date,
            row.temp_min,
            row.temp_max,
            row.temp_moy,
            row.precipitation,
            row.vent_moy,
            row.vent_max
        ]
            .map((value) => (value === null || value === undefined ? '' : value.toString()))
            .some((value) => value.toLowerCase().includes(search));
    });
}

function sortMonthGroups(groups, column, direction) {
    const sorted = groups.slice().sort((a, b) => {
        if (column === 'date') {
            return a.key.localeCompare(b.key);
        }
        const aVal = a.summary[column];
        const bVal = b.summary[column];
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;
        return aVal - bVal;
    });
    return direction === 'asc' ? sorted : sorted.reverse();
}

function summarizeMonth(days) {
    const avg = (values) => {
        const valid = values.filter((v) => v !== null && v !== undefined);
        if (!valid.length) return null;
        return valid.reduce((a, b) => a + b, 0) / valid.length;
    };
    const sum = (values) => values.reduce((a, b) => a + (b || 0), 0);

    return {
        temp_min: avg(days.map((d) => d.temp_min)),
        temp_max: avg(days.map((d) => d.temp_max)),
        temp_moy: avg(days.map((d) => d.temp_moy)),
        precipitation: sum(days.map((d) => d.precipitation)),
        vent_moy: avg(days.map((d) => d.vent_moy)),
        vent_max: Math.max(...days.map((d) => d.vent_max || 0))
    };
}

function monthName(index) {
    const names = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
    return names[index] || '';
}

function formatValue(value, decimals) {
    if (value === null || value === undefined) return '-';
    return value.toFixed(decimals);
}

function handleTableToggle(event) {
    const toggle = event.target.closest('.month-toggle');
    const row = event.target.closest('.month-row');
    const monthKey = toggle?.dataset.month || row?.dataset.month;
    if (!monthKey) return;

    state.monthGroups = state.monthGroups.map((group) => {
        if (group.key === monthKey) {
            return { ...group, expanded: !group.expanded };
        }
        return group;
    });
    renderTable();
}

function animatePanel(elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;
    element.classList.remove('fade-up');
    requestAnimationFrame(() => {
        element.classList.add('fade-up');
        setTimeout(() => element.classList.remove('fade-up'), 600);
    });
}

function compareCommunes() {
    const commune1 = document.getElementById('compare1').value;
    const commune2 = document.getElementById('compare2').value;

    if (!commune1 || !commune2) {
        alert('Veuillez selectionner deux communes a comparer');
        return;
    }

    const data1 = state.meteoData.communes[commune1];
    const data2 = state.meteoData.communes[commune2];
    const metric = state.compareMetric;

    const ctx = document.getElementById('comparisonChart').getContext('2d');
    if (state.comparisonChart) {
        state.comparisonChart.destroy();
    }

    state.comparisonChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data1.donnees.map((d) => d.date),
            datasets: [
                buildLineDataset(`${commune1}`, data1.donnees.map((d) => d[metric]), '#ff8a3d'),
                buildLineDataset(`${commune2}`, data2.donnees.map((d) => d[metric]), '#2f5bff')
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: true, position: 'top' },
                title: { display: true, text: `Comparaison ${metricLabel(metric)}` },
                zoom: {
                    pan: { enabled: true, mode: 'x' },
                    zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }
                }
            }
        }
    });
}

function exportToCSV() {
    if (!state.currentCommune) {
        alert('Veuillez selectionner une commune.');
        return;
    }

    const rows = (state.currentTableData || []).filter((row) => {
        if (!state.tableSearch) return true;
        const search = state.tableSearch.toLowerCase();
        return Object.values(row)
            .map((value) => (value === null || value === undefined ? '' : value.toString()))
            .some((value) => value.toLowerCase().includes(search));
    });

    let csv = 'Date,Temp Min,Temp Max,Temp Moy,Precipitation,Vent Moy,Vent Max\n';
    rows.forEach((row) => {
        csv += `${row.date},${row.temp_min ?? ''},${row.temp_max ?? ''},${row.temp_moy ?? ''},${row.precipitation ?? ''},${row.vent_moy ?? ''},${row.vent_max ?? ''}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `meteo_${state.currentCommune}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
}

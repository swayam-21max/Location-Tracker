const socket = io();

// UI State
const urlParams = new URLSearchParams(window.location.search);
const room = urlParams.get('room') || 'default';
let userName = "Anonymous";
let userColor = "#3498db";

const markers = {};
const paths = {}; // Feature: Breadcrumbs
let myLastCoords = null;
let wakeLock = null;
let hasCentered = false;
let routingControl = null;

// Initialize Map
const map = L.map("map").setView([0, 0], 16);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
}).addTo(map);

// 🔍 Feature: Search & Fly (Geocoding)
const geocoder = L.Control.geocoder({
    defaultMarkGeocode: false
})
    .on('markgeocode', function (e) {
        const center = e.geocode.center;
        const bbox = e.geocode.bbox;
        const poly = L.polygon([
            bbox.getSouthEast(),
            bbox.getNorthEast(),
            bbox.getNorthWest(),
            bbox.getSouthWest()
        ]);

        map.fitBounds(poly.getBounds());

        // Add marker for search result
        L.marker(center)
            .addTo(map)
            .bindPopup(e.geocode.name)
            .openPopup();

        // 🚀 Automatically draw route to this searched location
        if (typeof window.calculateFastestRoute === 'function') {
            window.calculateFastestRoute(center.lat, center.lng);
        }
    })
    .addTo(map);

// UI Elements
const statusBadge = document.getElementById('connection-status');
const statusText = statusBadge ? statusBadge.querySelector('.text') : null;

const updateStatus = (state) => {
    if (!statusBadge) return;
    statusBadge.className = `status-badge ${state}`;
    if (statusText) {
        statusText.innerText = state.charAt(0).toUpperCase() + state.slice(1);
        if (state === 'connected') statusText.innerText = "Live";
    }
};

// 1. Connection & Automated Entry
socket.on("connect", () => {
    updateStatus('connected');
    userName = `User ${socket.id.substring(0, 4)}`;
    socket.emit("join-room", room);
    startTracking();
});

socket.on("disconnect", () => updateStatus('disconnected'));
socket.on("connect_error", () => updateStatus('connecting'));

// 2. Geolocation Logic
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {
        console.error("WakeLock failed:", err);
    }
}

function startTracking() {
    if (navigator.geolocation) {
        requestWakeLock();
        navigator.geolocation.watchPosition(
            (position) => {
                const { latitude, longitude, heading } = position.coords;
                myLastCoords = { latitude, longitude };

                if (socket.connected) {
                    socket.emit("send-location", {
                        latitude, longitude, name: userName, color: userColor,
                        heading: heading || 0, room: room
                    });
                }
            },
            (error) => console.error("Geo error:", error),
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
    }
}

// 3. Receive & Process Locations
socket.on("receive-location", (data) => {
    const { id, latitude, longitude, name, color, heading } = data;
    const isMe = id === socket.id;
    const coords = [latitude, longitude];

    if (isMe && !hasCentered) {
        map.setView(coords, 16);
        hasCentered = true;
    }

    // 🛣️ Feature: Breadcrumbs
    if (!paths[id]) {
        paths[id] = L.polyline([], {
            color: isMe ? '#007bff' : (color || 'red'),
            weight: 4,
            opacity: 0.6,
            className: 'user-path'
        }).addTo(map);
    }
    paths[id].addLatLng(coords);

    // Distance Calculation
    let distanceInfo = "";
    if (!isMe && myLastCoords) {
        const myLoc = L.latLng(myLastCoords.latitude, myLastCoords.longitude);
        const theirLoc = L.latLng(latitude, longitude);
        const distKm = (myLoc.distanceTo(theirLoc) / 1000).toFixed(2);
        distanceInfo = `<div style="font-size:12px; color:#666; margin-bottom:8px;">Distance: ${distKm} km</div>`;
    }

    const popupHTML = `
        <div style="text-align: center; min-width: 120px;">
            <b style="font-size:14px;">${isMe ? 'Me' : name}</b>
            ${distanceInfo}
            ${!isMe ? `<button onclick="calculateFastestRoute(${latitude}, ${longitude})" 
                        style="background:#2ecc71; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; width:100%; font-weight:bold;">
                        Get Route</button>` : ''}
        </div>
    `;

    if (markers[id]) {
        markers[id].setLatLng(coords);
        markers[id].setPopupContent(popupHTML);
        const markerElem = markers[id].getElement();
        if (markerElem) {
            const core = markerElem.querySelector('.marker-core');
            if (core) core.style.setProperty('--rotation', `${heading || 0}deg`);
        }
    } else {
        const icon = L.divIcon({
            className: `custom-marker-wrapper ${isMe ? 'self-marker-wrapper' : ''}`,
            html: `
                <div class="marker-core ${isMe ? 'pulse-animation' : ''}" 
                     style="background-color: ${color || '#3498db'}; 
                            width: 24px; height: 24px; 
                            border-radius: 50%; border: 3px solid white; 
                            box-shadow: 0 0 10px rgba(0,0,0,0.3);
                            display: flex; align-items: center; justify-content: center;
                            transition: transform 0.3s ease; --rotation: ${heading || 0}deg;
                            transform: rotate(var(--rotation));">
                    ${isMe ? '<div style="width: 8px; height: 8px; background: white; border-radius: 50%;"></div>' : ''}
                </div>`,
            iconSize: [24, 24], iconAnchor: [12, 12]
        });

        markers[id] = L.marker(coords, { icon }).addTo(map).bindPopup(popupHTML).openPopup();
    }
});

// 4. Routing Function
window.calculateFastestRoute = function (destLat, destLng) {
    if (!myLastCoords) { alert("Locating you..."); return; }
    if (routingControl) map.removeControl(routingControl);

    routingControl = L.Routing.control({
        waypoints: [L.latLng(myLastCoords.latitude, myLastCoords.longitude), L.latLng(destLat, destLng)],
        routeWhileDragging: false, addWaypoints: false, collapsible: true,
        lineOptions: { styles: [{ color: '#2ecc71', weight: 6, opacity: 0.9 }] },
        createMarker: function () { return null; }
    }).addTo(map);
};

socket.on("user-disconnected", (id) => {
    if (markers[id]) { map.removeLayer(markers[id]); delete markers[id]; }
    if (paths[id]) { map.removeLayer(paths[id]); delete paths[id]; }
});

document.getElementById('recenter-btn').addEventListener('click', () => {
    if (myLastCoords) map.flyTo([myLastCoords.latitude, myLastCoords.longitude], 16);
});

document.addEventListener('visibilitychange', () => {
    if (wakeLock !== null && document.visibilityState === 'visible') requestWakeLock();
});


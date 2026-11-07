
import { useEffect, useState } from "react";
import Map, { Marker, NavigationControl } from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { api } from "../lib/api.js";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

export default function SpotlightModal({ attractionId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!attractionId) return;

    const controller = new AbortController();

    async function fetchDetails() {
      try {
        setLoading(true);
        setError(null);
        setData(null);

        const result = await api.getAttraction(
          attractionId,
          controller.signal
        );

        setData(result.attraction);
      } catch (err) {
        if (err.name === "AbortError") return;

        console.error("Spotlight details error:", err);
        setError(err.message || "Failed to load attraction details.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    fetchDetails();

    return () => controller.abort();
  }, [attractionId]);

  if (!attractionId) return null;

  const hasCoordinates =
    data?.lat != null && data?.lng != null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] min-h-[400px] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-700 bg-[#1a1c23] shadow-2xl md:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close modal"
          className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-gray-800 text-white hover:bg-gray-700"
        >
          ✕
        </button>

        {loading && (
          <div className="flex min-h-[400px] w-full items-center justify-center text-white">
            Loading attraction...
          </div>
        )}

        {!loading && error && (
          <div className="flex min-h-[400px] w-full flex-col items-center justify-center gap-4 text-center">
            <p className="text-red-400">{error}</p>
            <button
              onClick={onClose}
              className="rounded-lg bg-gray-800 px-5 py-2 text-white"
            >
              Close
            </button>
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* Attraction Details */}
            <div className="flex w-full flex-col justify-center overflow-y-auto p-6 md:w-1/2 md:p-8">
              <span className="mb-2 text-xs font-bold uppercase tracking-wider text-orange-400">
                {data.category || "Spotlight"}
              </span>

              <h2 className="text-3xl font-bold text-white">
                {data.name}
              </h2>

              <p className="mb-6 mt-1 text-sm text-gray-400">
                {data.city}
              </p>

              <p className="mb-6 leading-relaxed text-gray-300">
                {data.description || "Discover this amazing experience."}
              </p>

              {data.avg_visit_min != null && (
                <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
                  <p className="text-xs uppercase tracking-wider text-gray-400">
                    Average visit time
                  </p>
                  <p className="mt-1 text-lg font-bold text-white">
                    {data.avg_visit_min} minutes
                  </p>
                </div>
              )}

              {data.tours?.length > 0 && (
                <div className="mt-5">
                  <h3 className="mb-2 font-semibold text-white">
                    Available tours
                  </h3>
                  {data.tours.map((tour) => (
                    <p key={tour.id} className="text-sm text-gray-300">
                      {tour.title}
                    </p>
                  ))}
                </div>
              )}
            </div>

            {/* Map */}
            <div className="relative h-[350px] w-full bg-gray-900 md:h-auto md:min-h-[450px] md:w-1/2">
              {hasCoordinates && MAPBOX_TOKEN ? (
                <Map
                  mapboxAccessToken={MAPBOX_TOKEN}
                  initialViewState={{
                    longitude: Number(data.lng),
                    latitude: Number(data.lat),
                    zoom: 12,
                  }}
                  mapStyle="mapbox://styles/mapbox/dark-v11"
                  style={{ width: "100%", height: "100%" }}
                >
                  <NavigationControl position="bottom-right" />

                  <Marker
                    longitude={Number(data.lng)}
                    latitude={Number(data.lat)}
                    anchor="bottom"
                  >
                    <div className="relative flex items-center justify-center">
                      <div className="absolute h-8 w-8 animate-ping rounded-full bg-orange-500 opacity-70" />
                      <div className="relative h-4 w-4 rounded-full border-2 border-white bg-orange-500" />
                    </div>
                  </Marker>
                </Map>
              ) : (
                <div className="flex h-full items-center justify-center text-gray-400">
                  {!MAPBOX_TOKEN
                    ? "Mapbox token is missing."
                    : "Location unavailable."}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

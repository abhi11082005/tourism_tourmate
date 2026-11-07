-- 1. Enable PostGIS extension (Run this once in your database)
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Create the Spotlights table
CREATE TABLE IF NOT EXISTS spotlights (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    image_url TEXT,
    category VARCHAR(50) DEFAULT 'Must visit', -- e.g., 'Must visit', 'Must eat'
    description TEXT,
    coordinates geometry(Point, 4326) -- Stores Longitude and Latitude
);

-- 3. Insert dummy data based on your screenshot
INSERT INTO spotlights (title, city, image_url, category, description, coordinates)
VALUES 
(
    'Nahargarh Sunset Point', 
    'Jaipur', 
    'https://res.cloudinary.com/demo/image/upload/nahargarh.jpg', 
    'Must visit', 
    'Experience the mesmerizing sunset over the Pink City from the heights of the Aravalli hills.',
    ST_SetSRID(ST_MakePoint(75.8155, 26.9373), 4326) -- Note: ST_MakePoint(Longitude, Latitude)
),
(
    'Amber Fort', 
    'Jaipur', 
    'https://res.cloudinary.com/demo/image/upload/amber_fort.jpg', 
    'Must visit', 
    'A magnificent fort built in pale yellow and pink sandstone, and with white marble.',
    ST_SetSRID(ST_MakePoint(75.8513, 26.9855), 4326)
);

-- 4. Create a spatial index for extremely fast location queries
CREATE INDEX spotlights_geom_idx ON spotlights USING GIST (coordinates);
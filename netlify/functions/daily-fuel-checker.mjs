import { schedule } from '@netlify/functions';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabase = createClient(supabaseUrl, supabaseSecretKey);
const mailgunApiKey = process.env.MG_KEY;
const mailgunDomain = process.env.MG_DOMAIN_SANDBOX;


async function getSubscriptions() {
	try {
		const { data, error } = await supabase
			.from('subscriptions')
			.select(`
                user_id,
                postcode,
                suburb,
				auth.users ( email )
            `)

		if (error) {
			console.error('Error fetching subscriptions:', error);
			return [];
		}
		if (!data || data.length === 0) {
			console.log('No subscriptions found.');
			return [];
		}

		console.log(`Found ${data.length} subscriptions.`);

		// Transform the data to flatten the users object
		const transformedData = data.map(subscription => ({
			user_id: subscription.user_id,
			postcode: subscription.postcode,
			suburb: subscription.suburb,
			email: subscription.users?.email
		}));

		return transformedData;
	} catch (error) {
		console.error('Error fetching subscriptions:', error);
		return [];
	}
}


// To learn about scheduled functions and supported cron extensions,
// see: https://ntl.fyi/sched-func
export const handler = schedule('0 0 * * *', async (event) => {
	const eventBody = JSON.parse(event.body);
	console.log(`Next function run at ${eventBody.next_run}.`);

	try {

		const subscriptions = await getSubscriptions();

		if (subscriptions.length === 0) {
			console.log('No subscriptions found. Exiting function.');
			return {
				statusCode: 200,
				body: JSON.stringify({ message: 'No subscriptions found.' })
			};
		}

		const results = [];

		// For each subscription, fetch the suburb bounding box
		for (const subscription of subscriptions) {
			const boundingBox = await getSuburbBoundingBox(subscription.suburb, subscription.postcode);
			if (!boundingBox) {
				console.error(`Failed to fetch bounding box for ${subscription.suburb}, ${subscription.postcode}.`);
				continue;
			}
			console.log(`Fetched bounding box for ${subscription.suburb}, ${subscription.postcode}:`, boundingBox);

			const response = await fetch(`https://www.fuelcheck.nsw.gov.au/fuel/api/v1/fuel/prices/bylocation?bottomLeftLatitude=${boundingBox.bottomLeftLatitude}&bottomLeftLongitude=${boundingBox.bottomLeftLongitude}&topRightLatitude=${boundingBox.topRightLatitude}&topRightLongitude=${boundingBox.topRightLongitude}&fuelType=E10-U91&radius=4&suburb=${subscription.suburb}&postcode=${subscription.postcode}`, {
				headers: {
					"Accept": "application/json"
				}
			});
			if (!response.ok) {
				console.error(`Error fetching fuel prices for ${subscription.suburb}, ${subscription.postcode}:`, response.statusText);
				continue;
			}

			const data = await response.json();

			// Find the station with the cheapest E10 or U91 price
			let cheapestStation = null;
			let cheapestPrice = Infinity;

			data.forEach(station => {
				const stationMinPrice = Math.min(...station.Prices
					.filter(price => price.FuelType === 'E10' || price.FuelType === 'U91')
					.map(price => price.Price));
				if (stationMinPrice < cheapestPrice) {
					cheapestPrice = stationMinPrice;
					cheapestStation = station;
				}
			});

			console.log('Cheapest fuel price:', cheapestPrice);
			console.log('Station name:', cheapestStation.Name);
			console.log('Station address:', cheapestStation.Address);

			await sendEmailNotification(subscription.email, {
				subscription: subscription.suburb,
				cheapestPrice,
				name: cheapestStation.Name,
				address: cheapestStation.Address
			});

			// Push the result to the results array
			results.push({
				subscription: subscription.suburb,
				cheapestPrice,
				name: cheapestStation.Name,
				address: cheapestStation.Address
			});
		}

		return {
			statusCode: 200,
			body: JSON.stringify(results)
		};
	} catch (error) {
		console.error('Error fetching fuel prices:', error);
		return {
			statusCode: 500,
			body: JSON.stringify({ error: 'Failed to fetch fuel prices' })
		};
	}
})

// This function fetches the bounding box of a suburb using the OneGov API.
async function getSuburbBoundingBox(suburbName, postcode) {
	console.log(`Fetching boundary for ${suburbName}, ${postcode}...`);
	const boundaryApiUrl = `https://api.onegov.nsw.gov.au/SmartmeterDashboardApp/suburbboundary/${postcode}/${suburbName.toUpperCase()}`;
	let boundaryData;

	try {
		const boundaryResponse = await fetch(boundaryApiUrl); // Removed non-standard timeout for broader compatibility
		if (!boundaryResponse.ok) {
			throw new Error(`HTTP error ${boundaryResponse.status} fetching boundary: ${boundaryResponse.statusText}`);
		}
		boundaryData = await boundaryResponse.json();

		if (!boundaryData || !boundaryData.GeoJson || !boundaryData.GeoJson.geometry) {
			console.error(`Invalid boundary data structure for ${suburbName}.`);
			return null;
		}

		console.log(`Received boundary data for ${suburbName}:`, boundaryData);

	} catch (error) {
		console.error(`Error fetching suburb boundary for ${suburbName}:`, error);
		return null;
	}

	try {
		const coordsList = boundaryData.GeoJson.geometry.coordinates;

		if (!coordsList || coordsList.length === 0) {
			console.error(`No coordinates found for ${suburbName}.`);
			return null;
		}

		let minLon = coordsList[0][0];
		let maxLon = coordsList[0][0];
		let minLat = coordsList[0][1];
		let maxLat = coordsList[0][1];

		for (const point of coordsList) {
			const lon = point[0];
			const lat = point[1]; // Altitude (point[2]) is ignored
			if (lon < minLon) minLon = lon;
			if (lon > maxLon) maxLon = lon;
			if (lat < minLat) minLat = lat;
			if (lat > maxLat) maxLat = lat;
		}

		const boundingBox = {
			bottomLeftLatitude: minLat,
			bottomLeftLongitude: minLon,
			topRightLatitude: maxLat,
			topRightLongitude: maxLon,
		};

		console.log(`Calculated bounding box for ${suburbName}:`);
		console.log(`  Bottom-Left: Lat=${boundingBox.bottomLeftLatitude}, Lon=${boundingBox.bottomLeftLongitude}`);
		console.log(`  Top-Right:   Lat=${boundingBox.topRightLatitude}, Lon=${boundingBox.topRightLongitude}`);
		return boundingBox;

	} catch (error) {
		console.error(`Error processing GeoJSON data for ${suburbName}:`, error);
		console.error("Received boundary data structure might be unexpected. Full boundary data:", boundaryData);
		return null;
	}
}

async function sendEmailNotification(userEmail, fuelData) {
	const emailEndpoint = `https://api.mailgun.net/v3/${mailgunDomain}/messages`;
	const auth = Buffer.from(`api:${mailgunApiKey}`).toString('base64');

	// Create URLSearchParams instead of FormData
	const formData = new URLSearchParams();
	formData.append('from', `Fuel Price Alert <postmaster@${mailgunDomain}>`);
	formData.append('to', userEmail);
	formData.append('subject', `Fuel Price Alert for ${fuelData.subscription}`);
	formData.append('text', `The cheapest fuel price in ${fuelData.subscription} is $${fuelData.cheapestPrice.toFixed(2)} at ${fuelData.name}, ${fuelData.address}`);
	formData.append('html', `
        <html>
            <body>
                <h2>Today's Cheapest Fuel Price Update</h2>
                <p>The cheapest fuel price in ${fuelData.subscription} is $${fuelData.cheapestPrice.toFixed(2)} at:</p>
                <p><strong>${fuelData.name}</strong></p>
                <p>${fuelData.address}</p>
            </body>
        </html>
    `);

	try {
		const response = await fetch(emailEndpoint, {
			method: 'POST',
			headers: {
				'Authorization': `Basic ${auth}`,
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: formData
		});

		if (!response.ok) {
			const errorBody = await response.json().catch(() => response.text()); // Try to parse as JSON, fallback to text
			console.error('Mailgun API Error Response:', errorBody);
			throw new Error(`Failed to send email: ${response.status} ${response.statusText}. Details: ${JSON.stringify(errorBody)}`);
		}

		console.log(`Email sent successfully to ${userEmail}`);
		return true;
	} catch (error) {
		console.error('Error sending email:', error);
		return false;
	}
}
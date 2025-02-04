const { schedule } = require('@netlify/functions');
const fetch = require('node-fetch');

// To learn about scheduled functions and supported cron extensions,
// see: https://ntl.fyi/sched-func
module.exports.handler = schedule('0 0 * * *', async (event) => {
	const eventBody = JSON.parse(event.body);
	console.log(`Next function run at ${eventBody.next_run}.`);

	try {
		const response = await fetch("https://www.fuelcheck.nsw.gov.au/fuel/api/v1/fuel/prices/bylocation?bottomLeftLatitude=-34.42770025664651&bottomLeftLongitude=150.76162939050292&topRightLatitude=-34.27151900468233&topRightLongitude=151.03577260949706&fuelType=E10-U91&radius=4&suburb=WOONONA&postcode=2517", {
			headers: {
				"Accept": "application/json"
			}
		});

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

		return {
			statusCode: 200,
			body: JSON.stringify({
				cheapestPrice,
				name: cheapestStation.Name,
				address: cheapestStation.Address
			})
		};
	} catch (error) {
		console.error('Error fetching fuel prices:', error);
		return {
			statusCode: 500,
			body: JSON.stringify({ error: 'Failed to fetch fuel prices' })
		};
	}
});

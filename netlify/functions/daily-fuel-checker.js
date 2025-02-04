import { schedule } from '@netlify/functions'


const handler = async function (event, context) {
	// Your logic to check fuel prices and perform necessary actions
	console.log("Daily fuel checker function ran successfully.");

	return {
		statusCode: 200,
		body: JSON.stringify({ message: "Daily fuel checker function ran successfully." })
	};
};

export const config = {
	schedule: "@daily"
}

export { handler }
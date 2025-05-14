<script setup>
import { supabase } from '../supabase'
import { onMounted, ref, toRefs } from 'vue'

const props = defineProps(['session'])
const { session } = toRefs(props)

const loading = ref(true)
const username = ref('')
const website = ref('')
const avatar_url = ref('')
const subscriptions = ref([])

onMounted(() => {
	getProfile()
	getSubscriptions()
})


async function getSubscriptions() {
	try {
		loading.value = true
		const { user } = session.value

		const { data, error } = await supabase
			.from('subscriptions')
			.select('id, postcode, suburb')
			.eq('user_id', user.id)

		if (error) throw error

		subscriptions.value = data || []
	} catch (error) {
		alert(error.message)
	} finally {
		loading.value = false
	}
}

async function addSubscription() {
	try {
		loading.value = true
		const { user } = session.value

		const { data, error } = await supabase
			.from('subscriptions')
			.insert({
				user_id: user.id,
				postcode: '0000', // Default value since NOT NULL
				suburb: 'New Location', // Default value since NOT NULL
			})
			.select()
			.single()

		if (error) throw error

		subscriptions.value.push(data)
	} catch (error) {
		alert(error.message)
	} finally {
		loading.value = false
	}
}

async function updateSubscription(subscription) {
	try {
		loading.value = true

		// Check if postcode and suburb are not empty
		if (!subscription.postcode || !subscription.suburb) {
			throw new Error('Postcode and suburb are required')
		}

		const { error } = await supabase
			.from('subscriptions')
			.update({
				postcode: subscription.postcode,
				suburb: subscription.suburb
			})
			.eq('id', subscription.id)

		if (error) throw error
	} catch (error) {
		alert(error.message)
	} finally {
		loading.value = false
	}
}

async function deleteSubscription(subscriptionId) {
	try {
		loading.value = true

		const { error } = await supabase
			.from('subscriptions')
			.delete()
			.eq('id', subscriptionId)

		if (error) throw error

		subscriptions.value = subscriptions.value.filter(s => s.id !== subscriptionId)
	} catch (error) {
		alert(error.message)
	} finally {
		loading.value = false
	}
}

async function getProfile() {
	try {
		loading.value = true
		const { user } = session.value

		const { data, error, status } = await supabase
			.from('profiles')
			.select(`username, website, avatar_url`)
			.eq('id', user.id)
			.single()

		if (error && status !== 406) throw error

		if (data) {
			username.value = data.username
			website.value = data.website
			avatar_url.value = data.avatar_url
		}
	} catch (error) {
		alert(error.message)
	} finally {
		loading.value = false
	}
}

async function updateProfile() {
	try {
		loading.value = true
		const { user } = session.value

		const updates = {
			id: user.id,
			username: username.value,
			website: website.value,
			avatar_url: avatar_url.value,
			updated_at: new Date(),
		}

		const { error } = await supabase.from('profiles').upsert(updates)

		if (error) throw error
	} catch (error) {
		alert(error.message)
	} finally {
		loading.value = false
	}
}

async function signOut() {
	try {
		loading.value = true
		const { error } = await supabase.auth.signOut()
		if (error) throw error
	} catch (error) {
		alert(error.message)
	} finally {
		loading.value = false
	}
}
</script>

<template>
	<h1>daily fuel checker</h1>
	<form class="form-widget" @submit.prevent="updateProfile">
		<div>
			<label for="email">Email</label>
			<input id="email" type="text" :value="session.user.email" disabled />
		</div>
		<div>
			<label for="username">Name</label>
			<input id="username" type="text" v-model="username" />
		</div>

		<div class="subscriptions-section">
			<h3>Location Subscriptions</h3>
			<button type="button" class="button secondary" @click="addSubscription" :disabled="loading">
				Add Location
			</button>

			<div v-for="subscription in subscriptions" :key="subscription.id" class="subscription-item">
				<div>
					<label :for="'postcode-' + subscription.id">Postcode</label>
					<input :id="'postcode-' + subscription.id" type="text" v-model="subscription.postcode"
						@change="updateSubscription(subscription)" pattern="[0-9]*" maxlength="4" required />
				</div>
				<div>
					<label :for="'suburb-' + subscription.id">Suburb</label>
					<input :id="'suburb-' + subscription.id" type="text" v-model="subscription.suburb"
						@change="updateSubscription(subscription)" required />
				</div>
				<button type="button" class="button danger" @click="deleteSubscription(subscription.id)"
					:disabled="loading">
					Remove
				</button>
			</div>
		</div>

		<div>
			<input type="submit" class="button primary block" :value="loading ? 'Loading ...' : 'Update'"
				:disabled="loading" />
		</div>

		<div>
			<button class="button block" @click="signOut" :disabled="loading">Sign Out</button>
		</div>
	</form>
</template>

<style scoped>
.subscriptions-section {
	margin-top: 2rem;
}

.subscription-item {
	display: grid;
	grid-template-columns: 1fr 1fr auto;
	gap: 1rem;
	margin-bottom: 1rem;
	padding: 1rem;
	border: 1px solid #ddd;
	border-radius: 4px;
}

.button.secondary {
	background: #4CAF50;
	margin-bottom: 1rem;
}

.button.danger {
	background: #f44336;
}
</style>
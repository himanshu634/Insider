// The message feed became Chats. Old links and bookmarks land there.
import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

export const load = () => {
	redirect(308, resolve('/chats'));
};

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Route, Router } from "wouter";
import AdminView from "./AdminView";
import App from "./App";
import CompleteEpisode from "./CompleteEpisode";
import ParentView from "./ParentView";
import PlayEpisode from "./PlayEpisode";
import "./index.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
	throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
	<StrictMode>
		<Router>
			<Route path="/" component={App} />
			<Route path="/admin" component={AdminView} />
			<Route path="/parent" component={ParentView} />
			<Route path="/play/:storySlug" component={PlayEpisode} />
			<Route
				path="/play/:storySlug/episode/:episodeIdx"
				component={PlayEpisode}
			/>
			<Route
				path="/play/:storySlug/complete/:episodeIdx"
				component={CompleteEpisode}
			/>
		</Router>
	</StrictMode>,
);

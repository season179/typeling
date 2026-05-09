import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Route, Router } from "wouter";
import App from "./App";
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
			<Route path="/play/:childId" component={PlayEpisode} />
		</Router>
	</StrictMode>,
);

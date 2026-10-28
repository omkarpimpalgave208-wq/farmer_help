PERPLECTRA — AGRICULTURAL DECISION INTELLIGENCE DEMO

FILES
- index.html : page structure
- styles.css : responsive visual styling
- app.js     : local rule-based decision logic and interactions

HOW TO RUN
1. Extract the ZIP to a folder.
2. Open index.html in Chrome, Edge, or Firefox.
3. Change crop/harvest inputs and press “Evaluate next action”.
4. Toggle scenario shocks and press “Recalculate decision”.

IMPORTANT LIMITATIONS
- This is a front-end prototype. No backend, AI model, database, or live market/weather/logistics API is connected.
- The values are illustrative demo inputs. Recommendations and option scores are produced by explicit JavaScript rules, not trained machine learning.
- Gross value is quantity × entered price. Delay exposure is a rough illustrative heuristic, not a verified financial-loss forecast.
- Do not use the recommendations for real agricultural or financial decisions until the data sources, assumptions, local agronomy, storage/processing economics, and decision rules have been validated.
- Google Fonts is used for typography when internet access is available; the page still works offline with fallback fonts.


FUNCTIONALITY UPDATE
- Harvest inputs and scenario toggles are evaluated locally by the decision rules.
- Current inputs and decision history are saved in browser local storage where supported.
- Decision history can be exported to CSV or cleared.
- Copy decision brief copies the current recommendation.
- This remains an illustrative rule-based prototype; it does not connect to live market feeds or a trained model.

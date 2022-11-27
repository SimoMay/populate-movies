import fs from 'node:fs/promises'

import delay from 'delay'
import makeDir from 'make-dir'
import pMap from 'p-map'

import * as config from './lib/config'
import * as types from './types'
import { loadRTMoviesFromCache, scrapeRottenTomatoesInfoByUrl } from './lib/rt'

/**
 * Fetches info on all previously downloaded movies from Rotten Tomatoes using
 * a cheerio-based scraper.
 *
 * @todo figure out a better mapping from tmdb/imdb IDs => rtUrl
 *
 * @example
 * ```
 * npx tsx src/populate-rt-movies.ts
 * IGNORE_EXISTING_RT_MOVIES=true npx tsx src/populate-rt-movies.ts
 * ```
 */
async function main() {
  const ignoreExistingRTMovies = !!process.env.IGNORE_EXISTING_RT_MOVIES
  await makeDir(config.outDir)

  const rtMovies = await loadRTMoviesFromCache()

  let batchNum = 0
  let numMoviesTotal = 0
  let numRTMoviesDownloadedTotal = 0

  do {
    const srcFile = `${config.outDir}/movies-${batchNum}.json`
    const movies: types.Movie[] = JSON.parse(
      await fs.readFile(srcFile, { encoding: 'utf-8' })
    )

    console.warn(
      `\npopulating ${movies.length} movies in batch ${batchNum} (${srcFile})\n`
    )

    let firstMovieInBatch = true
    const rtOutputMovies = (
      await pMap(
        movies,
        async (movie, index): Promise<Partial<types.Movie> | null> => {
          if (!movie.rtUrl) {
            return null
          }

          if (!ignoreExistingRTMovies && rtMovies[movie.tmdbId]) {
            return null
          }

          let numErrors = 0

          while (true) {
            try {
              console.warn(
                `${batchNum}:${index} rt ${movie.rtUrl} (${movie.releaseYear}) ${movie.title}`
              )

              const rtMovie = await scrapeRottenTomatoesInfoByUrl(movie.rtUrl)
              const result = (rtMovies[movie.tmdbId] = {
                ...rtMovies[movie.tmdbId],
                ...rtMovie
              })

              if (firstMovieInBatch) {
                firstMovieInBatch = false
                // console.warn()
                // console.warn(JSON.stringify(result, null, 2))
                // console.warn()
              }
              console.log(JSON.stringify(result, null, 2))

              // console.log(movie)
              // console.log(rtMovie)

              return result
            } catch (err) {
              console.error(
                'rt error',
                movie.rtUrl,
                movie.title,
                err.toString()
              )

              if (++numErrors >= 3) {
                return null
              } else {
                await delay(10000 + 1000 * numErrors * numErrors)
              }
            }
          }
        },
        {
          concurrency: 4
        }
      )
    ).filter(Boolean)

    const numMovies = movies.length
    const numRTMoviesDownloaded = rtOutputMovies.length

    numMoviesTotal += numMovies
    numRTMoviesDownloadedTotal += numRTMoviesDownloaded

    console.warn()
    console.warn(`batch ${batchNum} done`, {
      numMovies,
      numRTMoviesDownloaded,
      numRTMoviesTotal: Object.keys(rtMovies).length
    })

    await fs.writeFile(config.rtMoviesPath, JSON.stringify(rtMovies, null, 2), {
      encoding: 'utf-8'
    })

    ++batchNum
  } while (batchNum < config.numBatches)

  console.warn()
  console.warn('done', {
    numMoviesTotal,
    numRTMoviesDownloadedTotal,
    numRTMoviesTotal: Object.keys(rtMovies).length
  })
}

main()